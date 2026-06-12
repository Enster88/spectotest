import { getAuth } from '@clerk/nextjs/server';
import { supabase } from '../../lib/supabase';

export default async function handler(req, res) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Bejelentkezés szükséges.' });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('step_templates')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const { name, description, steps } = req.body;
    console.log('POST templates:', { name, steps, userId });
    if (!name || !steps?.length) return res.status(400).json({ error: 'Név és lépések kötelezők.' });

    const { data, error } = await supabase
      .from('step_templates')
      .insert({ user_id: userId, name, description, steps })
      .select()
      .single();

    if (error) { console.error('Supabase error:', error); return res.status(500).json({ error: error.message }); }
    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    const { id } = req.query;
    const { name, description, steps, disableTestData, flexibleMode } = req.body;
    const { data, error } = await supabase
      .from('step_templates')
      .update({ name, description, steps, disable_test_data: disableTestData || false, flexible_mode: flexibleMode || false })
      .eq('id', id).eq('user_id', userId)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // Clone template
  if (req.method === 'PATCH') {
    const { id } = req.query;
    const { data: orig, error: fetchErr } = await supabase
      .from('step_templates').select('*').eq('id', id).eq('user_id', userId).single();
    if (fetchErr) return res.status(404).json({ error: 'Nem található.' });
    const { data, error } = await supabase.from('step_templates').insert({
      user_id: userId,
      name: orig.name + ' (másolat)',
      description: orig.description,
      steps: orig.steps
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    const { error } = await supabase
      .from('step_templates')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deleted: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
