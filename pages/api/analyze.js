import Anthropic from '@anthropic-ai/sdk';
import { getAuth } from '@clerk/nextjs/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Bejelentkezés szükséges.' });

  const { specText, stepTemplates = [] } = req.body;

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
    templatesSection += `
IMPORTANT: 
- Generate test cases for EVERY template provided, not just the first one
- If a template name suggests "modification" or "edit", generate test cases that test modifications
- If a template name suggests "creation" or "new", generate test cases that test creation
- Assign the exact template name to each test case's "templateName" field`;
  }

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 16000,
      messages: [{
        role: 'user',
        content: `You are an expert QA engineer generating exhaustive regression test cases.

ALL text must be in ENGLISH ONLY - names, objectives, preconditions, test data, everything.

NAMING RULES:
- Format: "TCMx - Checking the [action] of a [entity] [condition] - Positive/Negative"
- Example: "TCM1 - Checking the creation of a Consumer Physical Unit with category FIP when IC is filled - Positive"

OBJECTIVE RULES:
- Always: "The goal of this test case is to verify that [full sentence]"
- Example: "The goal of this test case is to verify that the Consumer Physical unit can be created when the Physical Unit Category is FIP and the Installed Capacity is filled"

PRECONDITION: Always in English, e.g. "The user is logged into the BackOffice as MER-Operator"

LABELS: "HappyDay" for positive, "BadDay" for negative

PRIORITY: "Critical", "High", "Medium", or "Low"

TEST DATA RULES:
- Only add testData when the spec provides specific values or combinations to test
- Format: "Important attributes:\\n- Attribute: Value"
- For missing/empty values: "Important attributes:\\n- Attribute:"
- If no specific values needed, use empty string ""
- Never write just "Important attributes:" with nothing after it

EXHAUSTIVE COVERAGE RULES - this is critical:

ENTITY TYPE MULTIPLICATION:
- First, identify ALL entity types mentioned in the spec (e.g. Consumer, Producer, Transmission Line)
- For EACH test scenario × EACH entity type = separate TC
- Example: "FIT category with IC filled" for Consumer + for Producer + for Transmission Line = 3 TCs
- Name must include entity type: "Checking the creation of a Consumer Physical Unit..."

DELETED/REMOVED VALIDATIONS:
- If spec says a validation is DELETED or REMOVED, generate TCs to verify the deletion works
- Test that previously forbidden values are now ACCEPTED
- Example: if Name max-length validation deleted → test with 10, 50, 255+ chars
- Example: if special chars forbidden → test each special char: ', ", +, !, %, /, =, (, ), . separately
- Label these as Positive (they should now succeed)

BOUNDARY VALUE ANALYSIS:
- For each numeric attribute: min-1 (invalid), min (valid), min+1 (valid), max-1 (valid), max (valid), max+1 (invalid)
- For each string attribute: empty, 1 char, max-1 chars, max chars, max+1 chars
- For each enum/category: each valid value, invalid value

COMBINATION COVERAGE:
- Category changes: every direction (A→B, B→A for all combinations)
- IC with each category type separately
- Modification of each attribute separately

Aim for 60-100 test cases for a complex spec.
MUST use ALL provided templates proportionally.
- Generate a SEPARATE test case for EVERY combination mentioned in the spec
- For each entity type (Consumer, Producer, Transmission Line etc) × each category (FIT, FIP etc) = separate TC
- For each boundary value = separate TC  
- For each negative scenario = separate TC
- For modifications: test each attribute change separately
- Aim for 20-40 test cases for a complex spec, not just 10-15
- MUST generate test cases for ALL provided templates, not just one
${templatesSection}

Respond ONLY with valid JSON, no markdown.

{
  "summary": "brief summary of spec and test approach",
  "testCases": [
    {
      "id": "TCM1",
      "name": "TCM1 - Checking the [action] of a [entity] - Positive",
      "templateName": "[exact template name]",
      "priority": "Critical",
      "preconditions": "The user is logged into the BackOffice as MER-Operator",
      "objective": "The goal of this test case is to verify that...",
      "labels": "HappyDay",
      "testData": "Important attributes:\\n- Category: FIP\\n- Installed Capacity: 10"
    }
  ]
}

SPECIFICATION:
${specText.substring(0, 7000)}`
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
            const isDataStep = action.toLowerCase().includes('fills all') || action.toLowerCase().includes('fills the attributes') || action.toLowerCase().includes('modifies the attributes');
            return {
              action,
              expected,
              testData: isDataStep ? (tc.testData || '') : (typeof s === 'object' ? (s.testData || '') : '')
            };
          });
        } else {
          tc.steps = [{ action: 'Execute test case steps according to the test case', expected: 'Steps completed successfully', testData: tc.testData || '' }];
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
