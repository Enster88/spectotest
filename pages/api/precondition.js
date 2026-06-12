import Anthropic from '@anthropic-ai/sdk';
import { getAuth } from '@clerk/nextjs/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Bejelentkezés szükséges.' });

  const { entityType, state, tcType, context } = req.body;
  if (!entityType) return res.status(400).json({ error: 'Entity type required.' });

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Generate a SHORT precondition sentence for a test case.

Entity/context: ${entityType}
State/condition: ${state || 'ready'}
TC type: ${tcType || 'positive'}
Additional context: ${context || ''}

Rules:
- Start with "The user is logged into the BackOffice as MER-Operator."
- Add ONE short sentence about the specific state
- Keep total under 150 characters
- No extra details about permissions, UI availability, etc.
- For positive TC: state ready/approved/calculated
- For negative TC: state NOT approved/NOT available/missing

Return ONLY the precondition text, no JSON, no explanation.`
      }]
    });

    const precondition = message.content.map(b => b.text || '').join('').trim();
    res.status(200).json({ precondition });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Generation error.' });
  }
}
