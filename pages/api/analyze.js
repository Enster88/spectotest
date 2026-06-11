import Anthropic from '@anthropic-ai/sdk';
import { getAuth } from '@clerk/nextjs/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Bejelentkezés szükséges.' });

  const { specText, language = 'hu', stepTemplates = [] } = req.body;

  if (!specText || specText.trim().length < 20) {
    return res.status(400).json({ error: 'Túl rövid a specifikáció.' });
  }

  // Build step templates context
  let templatesContext = '';
  if (stepTemplates.length > 0) {
    templatesContext = `\n\nElérhető lépés sablonok (használd ezeket a navigációs és UI lépésekhez ahol releváns):\n`;
    stepTemplates.forEach(t => {
      templatesContext += `\n### ${t.name}\n`;
      if (t.description) templatesContext += `${t.description}\n`;
      t.steps.forEach(s => {
        templatesContext += `- ${typeof s === 'object' ? s.action : s}\n`;
      });
    });
  }

    const langInstruction = language === 'en'
    ? 'Generate all test cases in English.'
    : 'Minden tesztesetet magyar nyelven generálj.';

  try {
    console.log('Starting analysis, text length:', specText.length);
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8096,
      messages: [{
        role: 'user',
        content: `Te egy tapasztalt QA mérnök vagy. Elemezd az alábbi szoftver specifikációt és generálj regressziós teszteset ötleteket belőle.

${langInstruction}

Válaszolj KIZÁRÓLAG valid JSON-ban, semmi más szöveg nélkül.

Struktúra:
{
  "summary": "A spec rövid összefoglalója 2-3 mondatban",
  "testCases": [
    {
      "id": "TC001",
      "title": "Teszteset rövid címe",
      "category": "Funkcionális | Negatív | Határérték | UI | Teljesítmény | Biztonság",
      "priority": "Magas | Közepes | Alacsony",
      "preconditions": "Előfeltételek",
      "steps": [
        {"action": "Lépés szövege számozás nélkül", "expected": "Lépés elvárt eredménye"},
        {"action": "Következő lépés", "expected": "Ennek a lépésnek az elvárt eredménye"}
      ],
      "notes": "Megjegyzések, kockázatok (opcionális)"
    }
  ]
}

Generálj 10-20 tesztesetet. Fontos szabályok a lépésekre:
- Minden lépés egyetlen atomikus UI akció legyen (pl. "A felhasználó rákattint az Email cím mezőre", "A felhasználó beírja az email címet: test@example.com", "A felhasználó rákattint a Jelszó mezőre")
- NE számozd a lépéseket (ne írj "1.", "2." előtagot)
- Minden lépéshez adj meg elvárt eredményt az "expected" mezőben
- Minden TC-hez legalább 5-8 lépés legyen, UI navigációval együtt
- A lépések legyenek konkrétak és követhetők

Fókuszálj:
- Happy path tesztesetekre
- Negatív tesztesetekre (hibás bemenetek, edge case-ek)
- Határérték analízisre
- Regressziós kockázatokra
- UI/UX ellenőrzésekre ahol releváns

Specifikáció:
${specText.substring(0, 7000)}${templatesContext}`
      }]
    });

    const raw = message.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
    const result = JSON.parse(raw);
    res.status(200).json(result);
  } catch (e) {
    console.error('Analysis error:', e.message, e.status);
    res.status(500).json({ error: e.message || 'Elemzési hiba. Kérlek próbáld újra.' });
  }
}
