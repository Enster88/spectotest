import Anthropic from '@anthropic-ai/sdk';
import { getAuth } from '@clerk/nextjs/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Bejelentkezés szükséges.' });

  const { specText, language = 'en', stepTemplates = [] } = req.body;

  if (!specText || specText.trim().length < 20) {
    return res.status(400).json({ error: 'Túl rövid a specifikáció.' });
  }

  const langNote = language === 'hu'
    ? 'Generate all names, objectives, preconditions and test data in HUNGARIAN.'
    : 'Generate all names, objectives, preconditions and test data in ENGLISH.';

  // Build template list for AI
  let templatesSection = '';
  if (stepTemplates.length > 0) {
    templatesSection = '\n\nAVAILABLE STEP TEMPLATES:\n';
    stepTemplates.forEach(t => {
      const steps = t.steps.map(s => typeof s === 'object' ? s.action : s);
      templatesSection += `\nTemplate name: "${t.name}"\nSteps:\n${steps.map(s => `  - ${s}`).join('\n')}\n`;
    });
    templatesSection += `\nFor each test case, pick the most appropriate template from the list above based on what the test case is doing (creation, modification, validity change, etc.). Set "templateName" to exactly the template name you chose.`;
  } else {
    templatesSection = '\n\nNo step templates provided. Generate generic steps for each test case.';
  }

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 16000,
      messages: [{
        role: 'user',
        content: `You are an expert QA engineer. Analyze the specification and generate regression test cases.

${langNote}

RULES:
1. NAME: "TCMx - [what is tested] - Positive" or "TCMx - [what is tested] - Negative"
2. OBJECTIVE: Always "The goal of this test case is to verify that [full sentence]"
3. LABELS: "HappyDay" for positive, "BadDay" for negative
4. PRIORITY: "Critical", "High", "Medium", or "Low"
5. TEST DATA: For the attributes step use format: "Important attributes:\\n- Attribute: Value"
   For negative/missing: "Important attributes:\\n- Attribute:"
6. TEMPLATE SELECTION: Choose the best matching template for each TC based on the action (create/modify/delete/etc.)
${templatesSection}

Respond ONLY with valid JSON, no markdown.

JSON structure:
{
  "summary": "brief summary",
  "testCases": [
    {
      "id": "TCM1",
      "name": "TCM1 - [description] - Positive",
      "templateName": "[exact template name or null if no templates]",
      "priority": "Critical",
      "preconditions": "The user is...",
      "objective": "The goal of this test case is to verify that...",
      "labels": "HappyDay",
      "testData": "Important attributes:\\n- Attribute: Value"
    }
  ]
}

Note: Only generate testData for the step that fills attributes. The steps themselves will come from the template.

Generate 10-15 test cases covering happy path, negative, and boundary cases.

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

    // Attach actual steps from templates to each TC
    if (stepTemplates.length > 0) {
      result.testCases = result.testCases.map(tc => {
        const template = stepTemplates.find(t => t.name === tc.templateName);
        if (template) {
          tc.steps = template.steps.map(s => {
            const action = typeof s === 'object' ? s.action : s;
            // Inject testData into the "fills all attributes" step
            const isDataStep = action.toLowerCase().includes('fills all') || action.toLowerCase().includes('fills the attributes');
            return {
              action,
              expected: typeof s === 'object' ? (s.expected || '') : '',
              testData: isDataStep ? (tc.testData || '') : ''
            };
          });
        } else {
          // No template matched - generate generic steps
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
