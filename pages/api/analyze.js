import Anthropic from '@anthropic-ai/sdk';
import { getAuth } from '@clerk/nextjs/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };

async function extractFileText(base64, fileType) {
  if (!base64 || !fileType) return null;
  const buffer = Buffer.from(base64, 'base64');
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Bejelentkezés szükséges.' });

  const {
    specText, specFileBase64, specFileType,
    oldSpecText, oldSpecFileBase64, oldSpecFileType,
    diffMode = false,
    stepTemplates = [], existingTestCases = [], generateMore = 0
  } = req.body;

  // Extract new spec text
  let finalText = specText || '';
  if (specFileBase64 && specFileType) {
    try {
      finalText = await extractFileText(specFileBase64, specFileType) || finalText;
    } catch(e) {
      return res.status(400).json({ error: 'Nem sikerült kiolvasni az új spec fájlt.' });
    }
  }

  if (!finalText || finalText.trim().length < 20) {
    return res.status(400).json({ error: 'Túl rövid a specifikáció.' });
  }

  // Extract old spec text for diff mode
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
  if (stepTemplates.length > 0) {
    templatesSection = '\n\nAVAILABLE STEP TEMPLATES:\n';
    stepTemplates.forEach(t => {
      const steps = t.steps.map(s => typeof s === 'object' ? s.action : s);
      templatesSection += `\nTemplate: "${t.name}"\nSteps:\n${steps.map(s => `  - ${s}`).join('\n')}\n`;
    });
    templatesSection += '\nIMPORTANT: Assign exact template name to each TC. Use ALL templates proportionally.';
  }

  // Build existing TCs context
  let existingContext = '';
  const startIdx = existingTestCases.length + 1;
  if (generateMore > 0 && existingTestCases.length > 0) {
    existingContext = `\n\nALREADY COVERED (do NOT duplicate):\n`;
    existingContext += existingTestCases.map(tc => `- ${tc.name}`).join('\n');
    existingContext += `\n\nGenerate exactly ${generateMore} NEW test cases starting from TCM${startIdx}.`;
  }

  const countInstruction = generateMore > 0
    ? `Generate exactly ${generateMore} new test cases (TCM${startIdx} onwards).`
    : 'Aim for 60-100 test cases for a complex spec.';

  // Build diff section
  const diffSection = diffMode && oldText.trim().length > 20 ? `

DIFF MODE - SPEC COMPARISON:
Old specification:
${oldText.substring(0, 3000)}

New specification changes to analyze:
Focus ONLY on what is NEW or MODIFIED between old and new spec.
Generate test cases ONLY for the changed parts.
Also return a "diffSummary" object with:
- added: array of new requirements/rules added
- modified: array of changed requirements/rules  
- deleted: array of removed requirements/rules
` : '';

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 16000,
      messages: [{
        role: 'user',
        content: `You are an expert QA engineer generating exhaustive regression test cases.

ALL text in ENGLISH ONLY.

NAMING: "TCMx - Checking the [action] of a [EntityType] [condition] - Positive/Negative"
OBJECTIVE: "The goal of this test case is to verify that [full sentence]"
PRECONDITION: English, e.g. "The user is logged into the BackOffice as MER-Operator"
LABELS: "HappyDay" positive, "BadDay" negative
PRIORITY: "Critical", "High", "Medium", "Low"

TEST DATA:
- Only when spec provides specific values
- Format: "Important attributes:\\n- Attribute: Value"
- Missing: "Important attributes:\\n- Attribute:"
- Empty string if no specific values needed

EXHAUSTIVE COVERAGE:
- Entity types × categories = separate TC per combination
- Include entity type in name
- Deleted validations: TCs verifying previously forbidden values NOW WORK
- Boundary values: min-1(invalid), min(valid), max(valid), max+1(invalid)
- ${countInstruction}
- Use ALL templates proportionally
${templatesSection}${existingContext}${diffSection}

Respond ONLY with valid JSON:
{
  "summary": "brief summary",
  "diffSummary": {
    "added": ["new rule 1", "new rule 2"],
    "modified": ["changed rule 1"],
    "deleted": ["removed rule 1"]
  },
  "testCases": [
    {
      "id": "TCM${startIdx}",
      "name": "TCM${startIdx} - Checking the...",
      "templateName": "[exact template name or null]",
      "priority": "Critical",
      "preconditions": "The user is logged into the BackOffice as MER-Operator",
      "objective": "The goal of this test case is to verify that...",
      "labels": "HappyDay",
      "testData": ""
    }
  ]
}

Note: diffSummary can be null if not in diff mode.

SPECIFICATION:
${finalText.substring(0, generateMore > 0 ? 5000 : 7000)}`
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

    // Attach steps from templates
    if (stepTemplates.length > 0) {
      result.testCases = result.testCases.map(tc => {
        const template = stepTemplates.find(t => t.name === tc.templateName);
        if (template) {
          tc.steps = template.steps.map(s => {
            const action = typeof s === 'object' ? s.action : s;
            const expected = typeof s === 'object' ? (s.expected || '') : '';
            const staticData = typeof s === 'object' ? (s.testData || '') : '';
            const isDataStep = action.toLowerCase().includes('fills all') ||
              action.toLowerCase().includes('fills the attributes') ||
              action.toLowerCase().includes('modifies the attributes');
            return { action, expected, testData: isDataStep ? (tc.testData || '') : staticData };
          });
        } else {
          tc.steps = [{ action: 'Execute test case steps', expected: 'Steps completed successfully', testData: tc.testData || '' }];
        }
        return tc;
      });
    }

    res.status(200).json(result);
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Elemzési hiba. Kérlek próbáld újra.' });
  }
}
