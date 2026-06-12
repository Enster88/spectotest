import Anthropic from '@anthropic-ai/sdk';
import { getAuth } from '@clerk/nextjs/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Bejelentkezés szükséges.' });

  const { testCases, specSummary } = req.body;
  if (!testCases?.length) return res.status(400).json({ error: 'Nincsenek tesztesetek.' });

  try {
    const tcList = testCases.map(tc => `${tc.id}: ${tc.name} [${tc.labels}]`).join('\n');

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Analyze these test cases and build a coverage matrix.

TEST CASES:
${tcList}

${specSummary ? `SPEC CONTEXT:\n${specSummary}` : ''}

Return ONLY valid JSON:
{
  "dimensions": {
    "rows": ["entity/category combinations found, e.g. A67, A68, A60, A61 or Physical Unit FIP, Physical Unit FIT etc"],
    "cols": ["Positive", "Negative", "Boundary", "Manual", "Automatic"]
  },
  "matrix": {
    "A67": {
      "Positive": ["TCM1", "TCM2"],
      "Negative": ["TCM21"],
      "Boundary": [],
      "Manual": ["TCM5"],
      "Automatic": ["TCM1"]
    }
  },
  "missing": [
    "A68 - Negative cases missing",
    "A60 - Boundary values missing"
  ],
  "stats": {
    "total": 24,
    "positive": 20,
    "negative": 4,
    "boundary": 3,
    "coverage_percent": 75
  }
}`
      }]
    });

    const raw = message.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
    const result = JSON.parse(raw);
    res.status(200).json(result);
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Coverage analysis error: ' + e.message });
  }
}
