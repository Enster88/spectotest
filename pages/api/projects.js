import { getAuth } from '@clerk/nextjs/server';
import { supabase } from '../../lib/supabase';

export const config = { api: { bodyParser: { sizeLimit: '50mb' } } };

export default async function handler(req, res) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Bejelentkezés szükséges.' });

  if (req.method === 'GET') {
    const { id } = req.query;
    if (id) {
      const { data, error } = await supabase
        .from('projects').select('*').eq('id', id).eq('user_id', userId).single();
      if (error) return res.status(404).json({ error: 'Projekt nem található.' });
      return res.status(200).json(data);
    }
    const { data, error } = await supabase
      .from('projects').select('id, name, created_at, updated_at')
      .eq('user_id', userId).order('updated_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const { name, specText, templateIds, testCases, fixedFields } = req.body;
    if (!name) return res.status(400).json({ error: 'Név kötelező.' });
    const { data, error } = await supabase.from('projects').insert({
      user_id: userId, name,
      spec_text: specText || '',
      template_ids: templateIds || [],
      test_cases: testCases || [],
      fixed_fields: fixedFields || {}
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    const { id } = req.query;
    const { name, specText, templateIds, testCases, fixedFields } = req.body;
    const { data, error } = await supabase.from('projects').update({
      name, spec_text: specText, template_ids: templateIds,
      test_cases: testCases, fixed_fields: fixedFields,
      updated_at: new Date().toISOString()
    }).eq('id', id).eq('user_id', userId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    const { error } = await supabase.from('projects')
      .delete().eq('id', id).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deleted: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
