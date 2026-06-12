import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import { getAuth } from '@clerk/nextjs/server';
import { supabase } from '../../lib/supabase';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };

async function extractFileText(base64, fileType) {
  if (!base64 || !fileType) return null;
  let cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
  const buffer = Buffer.from(cleanBase64, 'base64');
  console.log('Buffer size:', buffer.length, 'First bytes:', buffer.slice(0, 4).toString('hex'));
  if (fileType === 'pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    return data.text;
  } else if (fileType === 'docx') {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  return null;
}

// Hash spec text for cache key
function hashSpec(text) {
  return crypto.createHash('md5').update(text.substring(0, 3000)).digest('hex');
}

// Get or create spec summary cache
async function getSpecSummary(userId, specText) {
  const hash = hashSpec(specText);

  // Try cache first
  const { data: cached } = await supabase
    .from('spec_cache')
    .select('spec_summary')
    .eq('user_id', userId)
    .eq('spec_hash', hash)
    .single();

  if (cached) {
    console.log('Spec cache hit');
    return cached.spec_summary;
  }

  // Generate summary with Haiku
  console.log('Spec cache miss - generating summary');
  const msg = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Extract a concise structured summary of this spec for test case generation. Include:
- Main entity/dataflow name
- All entity types, categories, process types, codes mentioned
- All validation rules (both new and deleted)
- All trigger types and conditions
- Boundary values mentioned
Keep it under 500 words, use bullet points.

SPEC:
${specText.substring(0, 6000)}`
    }]
  });

  const summary = msg.content.map(b => b.text || '').join('');

  // Save to cache
  await supabase.from('spec_cache').upsert({
    user_id: userId,
    spec_hash: hash,
    spec_summary: summary
  }, { onConflict: 'user_id,spec_hash' });

  return summary;
}

// Step 1: Generate TC metadata with Haiku (cheap + fast)
async function generateTCMetadata({ specText, specSummary, coverageMode, templatesSection, existingContext, diffSection, coverageInstruction, startIdx }) {
  const specContent = specSummary || specText.substring(0, 6000);
  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: `You are an expert QA engineer. Generate regression test case METADATA only (no steps).

ALL text in ENGLISH ONLY.

NAMING: "TCMx - Checking the [action] of [dataflow short name] [minimal condition] - Positive/Negative"
NAMING RULES:
- Use SHORT names, max 100 chars total
- ALWAYS include relevant process/category code (A67, A68, A60, A61, A02 etc.) if one exists
- Do NOT use vague words like "unified", "standard", "normal"
- For automatic vs manual: state it explicitly
- Use codes only (A67) - NOT human labels next to codes
- Examples of GOOD names:
  "TCM1 - Checking the automatic publication of ABEPO A67 - Positive"
  "TCM2 - Checking the manual republish of ABEPO A67 - Positive"
  "TCM3 - Checking the daily publication of ABEPO A60 - Positive"
- Examples of BAD names:
  "TCM1 - Checking the publication of ABEPO with unified trigger A67" (unified = vague)
  "TCM4 - Checking daily manual publish of ABEPO" (missing processType code)

OBJECTIVE: "The goal of this test case is to verify that [full sentence]"
PRECONDITION RULES:
- Keep preconditions SHORT and simple
- Default precondition for ALL positive TCs: "The user is logged into the BackOffice as MER-Operator"
- For negative TCs: "The user is logged into the BackOffice as MER-Operator" + one sentence about missing/invalid data
- Do NOT add: permissions info, UI availability, OSB status, channel info, system configuration details
- Do NOT write more than 2 sentences in precondition

DELETED/REMOVED FUNCTION HANDLING:
- If spec says trigger/function was REMOVED, generate a Negative TC with label "BadDay"
- Objective: "The goal of this test case is to verify that [deleted function] no longer exists/executes"
- These are NOT positive happy path TCs - they verify absence of functionality
LABELS: "HappyDay" for Positive TCs ONLY. "BadDay" for Negative TCs ONLY. This is MANDATORY - never use HappyDay for a Negative TC.
PRIORITY: "Critical", "High", "Medium", "Low"
TEST DATA: Only when spec provides specific values. Format: "Important attributes:\\n- Attribute: Value". Empty string if not needed.
${templatesSection}
${coverageInstruction}
${existingContext}${diffSection}

Respond ONLY with valid JSON:
{
  "summary": "brief summary",
  "diffSummary": null,
  "testCases": [
    {
      "id": "TCM${startIdx}",
      "name": "TCM${startIdx} - ...",
      "templateName": "[exact template name or null]",
      "priority": "Critical",
      "preconditions": "...",
      "objective": "The goal of this test case is to verify that...",
      "labels": "HappyDay",
      "testData": ""
    }
  ]
}

SPECIFICATION SUMMARY:
${specContent}`
    }]
  });

  const raw = message.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
  let result;
  try {
    result = JSON.parse(raw);
  } catch(e) {
    let fixed = raw;
    const lastBrace = fixed.lastIndexOf('}');
    if (lastBrace > 0) {
      fixed = fixed.substring(0, lastBrace + 1);
      const opens = (fixed.match(/{/g) || []).length;
      const closes = (fixed.match(/}/g) || []).length;
      for (let i = 0; i < opens - closes; i++) fixed += '}';
    }
    result = JSON.parse(fixed);
  }
  return result;
}

// Step 2: Generate adapted steps for flexible mode TCs in batches of 5
async function generateFlexibleSteps(tcs, templateMap, specText) {
  const results = {};
  const batchSize = 5;

  for (let i = 0; i < tcs.length; i += batchSize) {
    const batch = tcs.slice(i, i + batchSize);
    const batchPrompt = batch.map(tc => {
      const template = templateMap[tc.templateName];
      if (!template) return null;
      const steps = template.steps.map(s => ({
        action: typeof s === 'object' ? s.action : s,
        expected: typeof s === 'object' ? (s.expected || '') : '',
        testData: typeof s === 'object' ? (s.testData || '') : ''
      }));
      return `TC: ${tc.id} - ${tc.name}
Template steps to adapt:
${steps.map((s, idx) => `${idx+1}. Action: ${s.action} | Expected: ${s.expected}`).join('\n')}
Precondition: ${tc.preconditions}
TestData: ${tc.testData || 'none'}`;
    }).filter(Boolean).join('\n\n---\n\n');

    if (!batchPrompt) continue;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `Adapt these template steps for each specific test case.

CRITICAL RULES:
1. INCLUDE ALL STEPS: The adapted TC must contain EVERY step from the template - do not skip any steps
2. PROCESS CODES & TRIGGERS: Replace ALL process/trigger names to match the TC's specific processType:
   TRIGGER SELECTION - match trigger to TC cycle type:
   - TC about 15-minute cycle (A67/A68/A60/A61 15M) automatic → "Publish Preparation Settlement to TP"
   - TC about 15-minute manual republish → "Republish Preparation Settlement to TP Manually"
   - TC about QH+30 → "Republish Preparation Settlement [QH+30] Manually"
   - TC about daily cycle automatic → "Publish Preliminary Control Energy"
   - TC about daily cycle manual → "Publish Preliminary Control Energy manually (for manual execution)"
   - TC about monthly cycle → "Republish Monthly Control Energy to TP Manually (for manual execution)"
   - TC about corrections → "Republish Control Energy Corrections to TP Manually"
   - NEVER use: "Publish Preliminary aFRR Results to TP", "Publish Preliminary mFRR Results to TP", "Publish Control Energy and Prices", "Publish Corrected Data" - REMOVED
   - M+66 is DELETED - any TC about M+66 must verify it NO LONGER EXISTS
   - USE TC NAME to determine cycle: if name says "15M" or "15-minute" → 15M trigger; if "daily" → daily trigger; if "monthly" → monthly trigger
3. TRIGGER TYPE CONSISTENCY: automatic vs manual must match TC name and be consistent in ALL steps
   - Automatic: "The system automatically executes the process..."
   - Manual: "The user manually executes the process..."
4. DELETED FUNCTIONS: If TC objective mentions verifying something NO LONGER works or was removed:
   - Set trigger step expected to: "The process is not available/no longer exists in the system"
   - Set final validation expected to: "The user validates that no publication occurred"
5. LAST EXPECTED RESULT: Must be TC-specific, not generic. Include:
   - Specific processType code (A67/A68/A60/A61)
   - Specific data being validated (currency, granularity, mRID, etc.)
   - Example: "The user validates that the output file contains A67 prices with EUR currency formatted to 2 decimal places"
   - NOT: "The user validates that the output file contains the values that were..."
6. EXPECTED RESULTS: Single continuous sentence, no newlines
7. Keep exact same step count as template

Respond ONLY with valid JSON:
{
  "adaptedTCs": [
    {
      "id": "TCM1",
      "steps": [
        {"action": "adapted action", "expected": "specific expected result", "testData": ""}
      ]
    }
  ]
}

TEST CASES TO ADAPT:
${batchPrompt}

SPEC CONTEXT (use exact trigger/process names from here):
${specText.substring(0, 3000)}`
      }]
    });

    const raw = message.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
    try {
      const parsed = JSON.parse(raw);
      (parsed.adaptedTCs || []).forEach(atc => {
        results[atc.id] = atc.steps;
      });
    } catch(e) {
      console.error('Batch step generation error:', e.message);
    }
  }

  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Bejelentkezés szükséges.' });

  const {
    specText, specFileBase64, specFileType,
    oldSpecText, oldSpecFileBase64, oldSpecFileType,
    diffMode = false,
    coverageMode = 'regression',
    stepTemplates = [], existingTestCases = [], generateMore = 0
  } = req.body;

  // Extract new spec text
  let finalText = specText || '';
  if (specFileBase64 && specFileType) {
    try {
      finalText = await extractFileText(specFileBase64, specFileType) || finalText;
    } catch(e) {
      console.error('File extraction error:', e.message);
      return res.status(400).json({ error: 'Nem sikerült kiolvasni az új spec fájlt: ' + e.message });
    }
  }

  if (!finalText || finalText.trim().length < 20) {
    return res.status(400).json({ error: 'Túl rövid a specifikáció.' });
  }

  // Extract old spec for diff
  let oldText = oldSpecText || '';
  if (diffMode && oldSpecFileBase64 && oldSpecFileType) {
    try {
      oldText = await extractFileText(oldSpecFileBase64, oldSpecFileType) || oldText;
    } catch(e) {
      return res.status(400).json({ error: 'Nem sikerült kiolvasni a régi spec fájlt.' });
    }
  }

  // Build templates section
  let templatesSection = '';
  const templateMap = {};
  if (stepTemplates.length > 0) {
    templatesSection = '\nAVAILABLE STEP TEMPLATES:\n';
    stepTemplates.forEach(t => {
      templateMap[t.name] = t;
      const steps = t.steps.map(s => typeof s === 'object' ? s.action : s);
      const noData = t.disable_test_data ? ' [NO TEST DATA]' : '';
      const flexMode = t.flexible_mode ? ' [FLEXIBLE MODE - steps will be adapted per TC]' : ' [FIXED MODE]';
      templatesSection += `\nTemplate: "${t.name}"${noData}${flexMode}\nSteps:\n${steps.map(s => `  - ${s}`).join('\n')}\n`;
    });
    templatesSection += '\nAssign exact template name to each TC. Use ALL templates proportionally.';
  }

  // Existing TCs context
  const startIdx = existingTestCases.length + 1;
  let existingContext = '';
  if (generateMore > 0 && existingTestCases.length > 0) {
    existingContext = `\nALREADY COVERED (do NOT duplicate):\n`;
    existingContext += existingTestCases.map(tc => `- ${tc.name}`).join('\n');
    existingContext += `\nGenerate exactly ${generateMore} NEW test cases starting from TCM${startIdx}.`;
  }

  // Coverage instructions
  const hasFlexible = stepTemplates.some(t => t.flexible_mode);
  const coverageInstructions = {
    regression: `REGRESSION COVERAGE:
- Every entity type × every category combination = separate TC
- Every positive AND negative case for each combination
- Every boundary value (min-1 invalid, min valid, max valid, max+1 invalid, empty, special chars)
- Every direction of changes (A→B and B→A)
- Aim for 25-40 TCs.`,
    semi_regression: `SEMI-REGRESSION COVERAGE:
- ONE representative entity type × each category combination
- All positive AND negative cases (1 entity type per scenario)
- All boundary values for most critical attribute
- Aim for 15-25 TCs.`,
    smoke: `SMOKE COVERAGE:
- ONE TC per main spec requirement, happy path only
- ONE negative case per main validation rule
- NO boundary values unless critical
- Aim for 5-10 TCs maximum.`
  };

  const coverageInstruction = generateMore > 0
    ? `Generate exactly ${generateMore} NEW test cases starting from TCM${startIdx}.`
    : (coverageInstructions[coverageMode] || coverageInstructions.regression);

  // Diff section
  const diffSection = diffMode && oldText.trim().length > 20 ? `

DIFF MODE RULES:
1. Compare old vs new spec carefully
2. Generate TCs for ALL of these:
   - NEW triggers/functions added → positive TCs to verify they work
   - MODIFIED triggers/functions → TCs to verify new behavior
   - DELETED triggers/functions → TCs to verify they NO LONGER exist/work (label as Negative or mark in objective)
   - Changed values/codes → TCs to verify new values are used
3. Return diffSummary with:
   - added: array of new requirements
   - modified: array of changed requirements
   - deleted: array of removed requirements (these need TCs to verify deletion!)

OLD SPECIFICATION:
${oldText.substring(0, 3000)}` : '';

  try {
    // Get spec summary from cache or generate
    const specSummary = await getSpecSummary(userId, finalText);

    // Step 1: Generate metadata with Haiku
    const result = await generateTCMetadata({
      specText: finalText,
      specSummary,
      coverageMode, templatesSection, existingContext,
      diffSection, coverageInstruction, startIdx
    });

    // Step 2: Attach fixed template steps OR generate flexible steps
    const flexibleTCs = result.testCases.filter(tc => {
      const template = templateMap[tc.templateName];
      return template && template.flexible_mode;
    });

    let adaptedStepsMap = {};
    if (flexibleTCs.length > 0) {
      adaptedStepsMap = await generateFlexibleSteps(flexibleTCs, templateMap, finalText);
    }

    // Attach steps to all TCs
    result.testCases = result.testCases.map(tc => {
      const template = templateMap[tc.templateName];
      if (!template) return tc;

      const disableData = template.disable_test_data || false;
      const isFlexible = template.flexible_mode || false;

      if (isFlexible && adaptedStepsMap[tc.id]) {
        tc.steps = adaptedStepsMap[tc.id].map(s => ({
          action: s.action || '',
          expected: s.expected || '',
          testData: disableData ? '' : (s.testData || '')
        }));
      } else {
        tc.steps = template.steps.map(s => {
          const action = typeof s === 'object' ? s.action : s;
          const expected = typeof s === 'object' ? (s.expected || '') : '';
          const staticData = typeof s === 'object' ? (s.testData || '') : '';
          const isDataStep = action.toLowerCase().includes('fills all') ||
            action.toLowerCase().includes('fills the attributes') ||
            action.toLowerCase().includes('modifies the attributes');
          return { action, expected, testData: disableData ? '' : (isDataStep ? (tc.testData || '') : staticData) };
        });
      }
      return tc;
    });

    res.status(200).json(result);
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Elemzési hiba: ' + e.message });
  }
}
