import Anthropic from '@anthropic-ai/sdk';
import { getAuth } from '@clerk/nextjs/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Bejelentkezés szükséges.' });

  const { specText, stepTemplates = [], existingTestCases = [], generateMore = 0 } = req.body;

  if (!specText || specText.trim().length < 20) {
    return res.status(400).json({ error: 'Túl rövid a specifikáció.' });
  }

  let templatesSection = '';
  if (stepTemplates.length > 0) {
    templatesSection = '\n\nAVAILABLE STEP TEMPLATES (you MUST use these - generate test cases for EACH template that is relevant):\n';
    stepTemplates.forEach(t => {
      const steps = t.steps.map(s => typeof s === 'object' ? s.action : s);
      templatesSection += `\nTemplate: "${t.name}"\nSteps:\n${steps.map(s => `  - ${s}`).join('\n')}\n`;
    });
    templatesSection += `\nIMPORTANT: 
- Generate test cases for EVERY template provided, not just the first one
- Assign the exact template name to each test case's "templateName" field`;
  }

  // Build existing TCs context for generateMore
  let existingContext = '';
  const startIdx = existingTestCases.length + 1;
  if (generateMore > 0 && existingTestCases.length > 0) {
    existingContext = `\n\nALREADY COVERED TEST CASES (do NOT duplicate these, generate NEW ones covering gaps):\n`;
    existingContext += existingTestCases.map(tc => `- ${tc.name}`).join('\n');
    existingContext += `\n\nGenerate exactly ${generateMore} NEW test cases starting from TCM${startIdx}.\nFocus on combinations, boundary values, and scenarios NOT yet covered above.`;
  }

  const countInstruction = generateMore > 0
    ? `Generate exactly ${generateMore} new test cases (TCM${startIdx} onwards).`
    : 'Aim for 60-100 test cases for a complex spec.';

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 16000,
      messages: [{
        role: 'user',
        content: `You are an expert QA engineer generating exhaustive regression test cases.

ALL text must be in ENGLISH ONLY.

NAMING: "TCMx - Checking the [action] of a [EntityType] [condition] - Positive/Negative"
OBJECTIVE: "The goal of this test case is to verify that [full sentence]"
PRECONDITION: English only, e.g. "The user is logged into the BackOffice as MER-Operator"
LABELS: "HappyDay" for positive, "BadDay" for negative
PRIORITY: "Critical", "High", "Medium", or "Low"

TEST DATA:
- Only add testData when spec provides specific values
- Format: "Important attributes:\\n- Attribute: Value"
- For missing values: "Important attributes:\\n- Attribute:"
- If no specific values needed, use empty string ""

EXHAUSTIVE COVERAGE:
- Identify ALL entity types × ALL categories = separate TC per combination
- Include entity type in name: "Consumer Physical Unit", "Producer Physical Unit"
- For DELETED validations: generate TCs verifying previously forbidden values NOW WORK
- Boundary values: min-1(invalid), min(valid), max(valid), max+1(invalid), empty, special chars
- Modifications: each attribute change separately, each direction (A→B and B→A)
- ${countInstruction}
- MUST use ALL provided templates proportionally
${templatesSection}${existingContext}

Respond ONLY with valid JSON:
{
  "summary": "brief summary",
  "testCases": [
    {
      "id": "TCM${startIdx}",
      "name": "TCM${startIdx} - Checking the...",
      "templateName": "[exact template name]",
      "priority": "Critical",
      "preconditions": "The user is logged into the BackOffice as MER-Operator",
      "objective": "The goal of this test case is to verify that...",
      "labels": "HappyDay",
      "testData": ""
    }
  ]
}

SPECIFICATION:
${specText.substring(0, generateMore > 0 ? 5000 : 7000)}`
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
            const isDataStep = action.toLowerCase().includes('fills all') || action.toLowerCase().includes('fills the attributes') || action.toLowerCase().includes('modifies the attributes');
            return {
              action,
              expected,
              testData: isDataStep ? (tc.testData || '') : staticData
            };
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
