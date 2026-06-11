import { useState } from 'react';
import Head from 'next/head';
import { useUser, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';

export default function Home() {
  const { isSignedIn, user } = useUser();

  // Steps: 'input' | 'loading' | 'review' | 'export'
  const [step, setStep] = useState('input');
  const [specText, setSpecText] = useState('');
  const [specFile, setSpecFile] = useState(null);
  const [templateFile, setTemplateFile] = useState(null);
  const [fixedFields, setFixedFields] = useState({
    status: 'Draft',
    priority: 'Medium',
    folder: '',
    component: '',
    labels: '',
    owner: '',
    test_type: 'Functional',
    test_set: ''
  });
  const [showFixedFields, setShowFixedFields] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedTemplates, setSelectedTemplates] = useState([]);
  const [newTemplate, setNewTemplate] = useState({ name: '', description: '', stepsText: '' });
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [templateBase64, setTemplateBase64] = useState(null);
  const [language, setLanguage] = useState('hu');
  const [result, setResult] = useState(null);
  const [testCases, setTestCases] = useState([]);
  const [loadingText, setLoadingText] = useState('Elemezzük a specifikációt...');
  const [error, setError] = useState('');

  const loadingMsgs = [
    'Elemezzük a specifikációt...',
    'Azonosítjuk a funkciókat...',
    'Generáljuk a teszteseteket...',
    'Regressziós kockázatokat keresünk...',
    'Összeállítjuk az eredményt...'
  ];

  const handleSpecFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSpecFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setSpecText(ev.target.result);
    reader.readAsText(file);
  };

  const handleTemplateFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setTemplateFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setTemplateBase64(ev.target.result.split(',')[1]);
    reader.readAsDataURL(file);
  };

  const analyze = async () => {
    if (!specText.trim() || specText.trim().length < 20) {
      setError('Kérlek illessz be vagy tölts fel egy specifikációt.');
      return;
    }
    setError('');
    setStep('loading');

    let i = 0;
    const interval = setInterval(() => {
      i = Math.min(i + 1, loadingMsgs.length - 1);
      setLoadingText(loadingMsgs[i]);
    }, 2500);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specText, language, stepTemplates: templates.filter(t => selectedTemplates.includes(t.id)) })
      });
      const data = await res.json();
      clearInterval(interval);
      if (data.error) throw new Error(data.error);
      setResult(data);
      setTestCases(data.testCases.map(tc => ({ ...tc, selected: true, editing: false })));
      setStep('review');
    } catch (e) {
      clearInterval(interval);
      setError(e.message);
      setStep('input');
    }
  };

  const toggleSelect = (id) => {
    setTestCases(prev => prev.map(tc => tc.id === id ? { ...tc, selected: !tc.selected } : tc));
  };

  const selectAll = () => setTestCases(prev => prev.map(tc => ({ ...tc, selected: true })));
  const deselectAll = () => setTestCases(prev => prev.map(tc => ({ ...tc, selected: false })));

  const updateField = (id, field, value) => {
    setTestCases(prev => prev.map(tc => tc.id === id ? { ...tc, [field]: value } : tc));
  };

  const saveTemplate = async () => {
    if (!newTemplate.name || !newTemplate.stepsText) return;
    const steps = newTemplate.stepsText
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => ({ action: s, expected: '' }));

    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTemplate.name, description: newTemplate.description, steps })
    });
    const data = await res.json();
    if (!data.error) {
      setTemplates(prev => [data, ...prev]);
      setNewTemplate({ name: '', description: '', stepsText: '' });
      setAddingTemplate(false);
    }
  };

  const deleteTemplate = async (id) => {
    await fetch(`/api/templates?id=${id}`, { method: 'DELETE' });
    setTemplates(prev => prev.filter(t => t.id !== id));
    setSelectedTemplates(prev => prev.filter(i => i !== id));
  };

  const toggleTemplate = (id) => {
    setSelectedTemplates(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const exportXLS = async () => {
    const selected = testCases.filter(tc => tc.selected);
    if (!selected.length) { setError('Válassz ki legalább egy tesztesetet.'); return; }

    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testCases: selected, fixedFields })
      });

      if (!res.ok) throw new Error('Export hiba.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'testcases.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  };

  const priorityColor = { 'Magas': '#991B1B', 'High': '#991B1B', 'Közepes': '#92400E', 'Medium': '#92400E', 'Alacsony': '#15803D', 'Low': '#15803D' };
  const priorityBg = { 'Magas': '#FEE2E2', 'High': '#FEE2E2', 'Közepes': '#FEF3C7', 'Medium': '#FEF3C7', 'Alacsony': '#E8F7EF', 'Low': '#E8F7EF' };

  return (
    <>
      <Head>
        <title>SpectoTest – Spec-ből tesztesetek azonnal</title>
        <meta name="description" content="Töltsd fel a specifikációt, kapj regressziós teszteset ötleteket és exportálj Zephyr-kompatibilis XLS-be." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #0F1117;
          --surface: #1A1D27;
          --surface2: #22263A;
          --border: #2E3248;
          --accent: #6366F1;
          --accent-light: #818CF8;
          --accent-bg: #1E1F3A;
          --text: #F1F2F6;
          --muted: #8B8FA8;
          --green: #34D399;
          --green-bg: #0F2A1F;
          --yellow: #FBBF24;
          --yellow-bg: #2A1F0F;
          --red: #F87171;
          --red-bg: #2A0F0F;
        }
        body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
        a { color: var(--accent-light); text-decoration: none; }

        nav { display: flex; align-items: center; justify-content: space-between; padding: 1rem 2rem; border-bottom: 1px solid var(--border); background: var(--bg); position: sticky; top: 0; z-index: 10; }
        .logo { font-family: 'Space Grotesk', sans-serif; font-size: 20px; font-weight: 700; color: var(--text); letter-spacing: -0.5px; }
        .logo span { color: var(--accent-light); }
        .nav-right { display: flex; align-items: center; gap: 10px; }
        .btn-ghost { background: none; border: 1px solid var(--border); border-radius: 8px; padding: 7px 16px; font-size: 13px; color: var(--muted); cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
        .btn-ghost:hover { border-color: var(--accent); color: var(--text); }
        .btn-primary { background: var(--accent); border: none; border-radius: 8px; padding: 7px 16px; font-size: 13px; color: #fff; cursor: pointer; font-family: 'Inter', sans-serif; font-weight: 500; transition: opacity .15s; }
        .btn-primary:hover { opacity: .85; }

        .hero { padding: 4rem 2rem 2rem; text-align: center; max-width: 700px; margin: 0 auto; }
        .hero-badge { display: inline-flex; align-items: center; gap: 6px; background: var(--accent-bg); border: 1px solid var(--accent); border-radius: 20px; padding: 4px 14px; font-size: 12px; color: var(--accent-light); margin-bottom: 1.5rem; font-weight: 500; }
        .hero h1 { font-family: 'Space Grotesk', sans-serif; font-size: 48px; line-height: 1.1; font-weight: 700; margin-bottom: 1rem; letter-spacing: -1px; }
        .hero h1 em { font-style: normal; color: var(--accent-light); }
        .hero p { font-size: 16px; color: var(--muted); line-height: 1.7; max-width: 500px; margin: 0 auto 2.5rem; }

        .main { max-width: 860px; margin: 0 auto; padding: 0 1.5rem 4rem; }

        .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; }
        .card-title { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1rem; display: flex; align-items: center; gap: 8px; }
        .card-title i { color: var(--accent-light); }

        .lang-toggle { display: flex; gap: 6px; margin-bottom: 1.25rem; }
        .lang-btn { flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: var(--muted); font-size: 13px; cursor: pointer; font-family: 'Inter', sans-serif; transition: all .15s; }
        .lang-btn.active { border-color: var(--accent); background: var(--accent-bg); color: var(--accent-light); }

        .upload-area { border: 1px dashed var(--border); border-radius: 10px; padding: 1.5rem; text-align: center; cursor: pointer; position: relative; transition: all .15s; margin-bottom: 1rem; }
        .upload-area:hover { border-color: var(--accent); background: var(--accent-bg); }
        .upload-area input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
        .upload-area i { font-size: 24px; color: var(--muted); display: block; margin-bottom: .5rem; }
        .upload-area p { font-size: 14px; color: var(--muted); }
        .upload-area span { font-size: 12px; color: #4B5563; }
        .upload-area.has-file { border-color: var(--green); background: var(--green-bg); }
        .upload-area.has-file i, .upload-area.has-file p { color: var(--green); }

        .divider { display: flex; align-items: center; gap: 10px; margin: 1rem 0; }
        .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
        .divider span { font-size: 12px; color: #4B5563; }

        textarea { width: 100%; height: 200px; resize: vertical; border: 1px solid var(--border); border-radius: 10px; padding: .875rem 1rem; font-size: 13px; font-family: 'Inter', sans-serif; color: var(--text); background: var(--surface2); line-height: 1.65; }
        textarea:focus { outline: none; border-color: var(--accent); }
        textarea::placeholder { color: #4B5563; }

        .analyze-btn { width: 100%; margin-top: 1rem; padding: 1rem; background: var(--accent); color: #fff; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font-family: 'Space Grotesk', sans-serif; letter-spacing: -.2px; transition: opacity .15s; }
        .analyze-btn:hover { opacity: .85; }

        .error-msg { background: var(--red-bg); border: 1px solid var(--red); border-radius: 8px; padding: .75rem 1rem; font-size: 13px; color: var(--red); margin-top: .75rem; }

        .loading { text-align: center; padding: 4rem 0; }
        .dots { display: flex; justify-content: center; gap: 6px; margin-bottom: 1rem; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
        .dot:nth-child(2) { animation-delay: .2s; }
        .dot:nth-child(3) { animation-delay: .4s; }
        @keyframes pulse { 0%, 100% { opacity: .2; transform: scale(.7); } 50% { opacity: 1; transform: scale(1); } }
        .loading p { font-size: 14px; color: var(--muted); }

        .review-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; flex-wrap: wrap; gap: .75rem; }
        .review-header h2 { font-family: 'Space Grotesk', sans-serif; font-size: 22px; font-weight: 600; }
        .review-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .review-summary { background: var(--accent-bg); border: 1px solid var(--accent); border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 1.25rem; font-size: 14px; color: var(--muted); line-height: 1.7; }
        .selected-count { font-size: 13px; color: var(--muted); }
        .selected-count strong { color: var(--accent-light); }

        .tc-list { display: flex; flex-direction: column; gap: .75rem; margin-bottom: 1.5rem; }
        .tc-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.25rem; transition: border-color .15s; cursor: pointer; }
        .tc-card.selected { border-color: var(--accent); background: var(--accent-bg); }
        .tc-card.deselected { opacity: .45; }
        .tc-top { display: flex; align-items: flex-start; gap: 10px; margin-bottom: .5rem; }
        .tc-checkbox { width: 18px; height: 18px; min-width: 18px; border-radius: 4px; border: 2px solid var(--border); background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .15s; margin-top: 2px; }
        .tc-card.selected .tc-checkbox { border-color: var(--accent); background: var(--accent); }
        .tc-id { font-size: 11px; color: var(--muted); font-weight: 500; background: var(--surface2); padding: 2px 8px; border-radius: 4px; margin-top: 3px; white-space: nowrap; }
        .tc-title { font-size: 14px; font-weight: 500; color: var(--text); flex: 1; }
        .tc-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: .5rem; }
        .tc-badge { font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 20px; }
        .tc-body { font-size: 13px; color: var(--muted); line-height: 1.6; }
        .tc-steps { margin-top: .5rem; }
        .tc-steps li { font-size: 13px; color: var(--muted); line-height: 1.6; margin-left: 1.25rem; }
        .tc-expected { font-size: 13px; color: var(--green); margin-top: .5rem; display: flex; gap: 6px; align-items: flex-start; }
        .tc-expected i { flex-shrink: 0; margin-top: 1px; }

        .fixed-fields { background: var(--surface2); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
        .fixed-fields-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; margin-top: .75rem; }
        .field-group label { font-size: 11px; color: var(--muted); display: block; margin-bottom: .3rem; font-weight: 500; letter-spacing: .5px; text-transform: uppercase; }
        .field-group input, .field-group select { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 13px; color: var(--text); font-family: 'Inter', sans-serif; }
        .field-group input:focus, .field-group select:focus { outline: none; border-color: var(--accent); }
        .template-card { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: .875rem 1rem; cursor: pointer; transition: all .15s; }
        .template-card:hover { border-color: var(--accent); }
        .template-card.selected { border-color: var(--accent); background: var(--accent-bg); }
        .template-steps { font-size: 12px; color: var(--muted); margin-top: .4rem; line-height: 1.6; }
        .template-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; margin-top: .75rem; }
        .new-template-form { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-top: .75rem; display: flex; flex-direction: column; gap: .75rem; }
        .new-template-form input, .new-template-form textarea { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font-size: 13px; color: var(--text); font-family: 'Inter', sans-serif; width: 100%; }
        .new-template-form input:focus, .new-template-form textarea:focus { outline: none; border-color: var(--accent); }
        .new-template-form textarea { height: 100px; resize: vertical; }
        .form-btns { display: flex; gap: 8px; justify-content: flex-end; }
        .btn-save { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 7px 16px; font-size: 13px; cursor: pointer; font-family: 'Inter', sans-serif; font-weight: 500; }
        .btn-cancel { background: none; border: 1px solid var(--border); border-radius: 6px; padding: 7px 16px; font-size: 13px; color: var(--muted); cursor: pointer; font-family: 'Inter', sans-serif; }
        .delete-btn { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 13px; padding: 2px 6px; border-radius: 4px; }
        .delete-btn:hover { color: var(--red); }
        .toggle-link { font-size: 12px; color: var(--accent-light); cursor: pointer; background: none; border: none; font-family: 'Inter', sans-serif; padding: 0; }
        .export-bar { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem 1.5rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; position: sticky; bottom: 1.5rem; }
        .export-bar-left { font-size: 14px; color: var(--muted); }
        .export-bar-left strong { color: var(--text); }
        .export-btn { background: var(--green); color: #0A1F15; border: none; border-radius: 8px; padding: 10px 24px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'Space Grotesk', sans-serif; display: flex; align-items: center; gap: 8px; transition: opacity .15s; }
        .export-btn:hover { opacity: .85; }
        .back-btn { background: none; border: 1px solid var(--border); border-radius: 8px; padding: 10px 16px; font-size: 13px; color: var(--muted); cursor: pointer; font-family: 'Inter', sans-serif; }
        .back-btn:hover { border-color: var(--accent); color: var(--text); }
      `}</style>

      <nav>
        <div className="logo">Specto<span>Test</span></div>
        <div className="nav-right">
          {!isSignedIn ? (
            <>
              <SignInButton mode="modal">
                <button className="btn-ghost">Bejelentkezés</button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="btn-primary">Regisztráció</button>
              </SignUpButton>
            </>
          ) : (
            <UserButton afterSignOutUrl="/" />
          )}
        </div>
      </nav>

      {step === 'input' && (
        <>
          <div className="hero">
            <div className="hero-badge"><i className="ti ti-test-pipe" /> QA Automation Tool</div>
            <h1>Specifikációból <em>tesztesetek</em>, azonnal</h1>
            <p>Töltsd fel a spec dokumentumot, és percek alatt megkapod a regressziós teszteset ötleteket – exportálva a saját Zephyr sablonodba.</p>
          </div>

          <div className="main">
            <div className="card">
              <div className="card-title"><i className="ti ti-language" /> Nyelv</div>
              <div className="lang-toggle">
                <button className={`lang-btn ${language === 'hu' ? 'active' : ''}`} onClick={() => setLanguage('hu')}>🇭🇺 Magyar</button>
                <button className={`lang-btn ${language === 'en' ? 'active' : ''}`} onClick={() => setLanguage('en')}>🇬🇧 English</button>
              </div>
            </div>

            <div className="card">
              <div className="card-title"><i className="ti ti-file-text" /> Specifikáció</div>
              <div className={`upload-area ${specFile ? 'has-file' : ''}`}>
                <input type="file" accept=".txt,.pdf,.md" onChange={handleSpecFile} />
                <i className={specFile ? 'ti ti-circle-check' : 'ti ti-upload'} />
                <p>{specFile ? specFile.name : 'Húzd ide a fájlt, vagy kattints'}</p>
                <span>.txt, .pdf, .md – max 10 MB</span>
              </div>
              <div className="divider"><span>vagy illeszd be közvetlenül</span></div>
              <textarea
                value={specText}
                onChange={e => setSpecText(e.target.value)}
                placeholder="Illeszd be a specifikáció szövegét ide...&#10;&#10;Pl: A rendszer lehetővé teszi a felhasználók számára hogy bejelentkezzenek email és jelszó kombinációval. A jelszónak minimum 8 karakterből kell állnia..."
              />
            </div>

            <div className="card">
              <div className="card-title"><i className="ti ti-table" /> XLS sablon (opcionális)</div>
              <div className={`upload-area ${templateFile ? 'has-file' : ''}`}>
                <input type="file" accept=".xlsx,.xls" onChange={handleTemplateFile} />
                <i className={templateFile ? 'ti ti-circle-check' : 'ti ti-upload'} />
                <p>{templateFile ? templateFile.name : 'Töltsd fel a saját Zephyr sablonod'}</p>
                <span>.xlsx, .xls – ha nincs sablon, alapértelmezett formátumot használunk</span>
              </div>
            </div>

            {isSignedIn && (
              <div className="card">
                <div className="card-title">
                  <i className="ti ti-books" /> Lépés könyvtár
                  <span style={{marginLeft:'auto',display:'flex',gap:'8px'}}>
                    {templates.length > 0 && <button className="toggle-link" onClick={() => setShowTemplates(!showTemplates)}>{showTemplates ? 'Elrejtés ▲' : `Megjelenítés (${templates.length}) ▼`}</button>}
                    <button className="toggle-link" onClick={() => setAddingTemplate(!addingTemplate)}>+ Új sablon</button>
                  </span>
                </div>
                <p style={{fontSize:'13px',color:'var(--muted)',lineHeight:'1.6'}}>
                  Add meg az ismétlődő navigációs és UI lépéseket. A generálás során ezeket a sablonokat felhasználjuk a tesztesetek összeállításához.
                </p>
                {addingTemplate && (
                  <div className="new-template-form">
                    <input
                      placeholder="Sablon neve (pl. MERACE bejelentkezés)"
                      value={newTemplate.name}
                      onChange={e => setNewTemplate(p => ({...p, name: e.target.value}))}
                    />
                    <input
                      placeholder="Leírás (opcionális)"
                      value={newTemplate.description}
                      onChange={e => setNewTemplate(p => ({...p, description: e.target.value}))}
                    />
                    <textarea
                      placeholder={"Lépések – soronként egy lépés:\nA felhasználó megnyitja a böngészőt\nA felhasználó navigál a MERACE BackOffice oldalra\nA felhasználó beírja a felhasználónevét\nA felhasználó beírja a jelszavát\nA felhasználó rákattint a Bejelentkezés gombra"}
                      value={newTemplate.stepsText}
                      onChange={e => setNewTemplate(p => ({...p, stepsText: e.target.value}))}
                    />
                    <div className="form-btns">
                      <button className="btn-cancel" onClick={() => setAddingTemplate(false)}>Mégse</button>
                      <button className="btn-save" onClick={saveTemplate}>Mentés</button>
                    </div>
                  </div>
                )}
                {showTemplates && templates.length > 0 && (
                  <div className="template-grid">
                    {templates.map(t => (
                      <div key={t.id} className={`template-card ${selectedTemplates.includes(t.id) ? 'selected' : ''}`} onClick={() => toggleTemplate(t.id)}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                          <span style={{fontSize:'13px',fontWeight:'500',color:'var(--text)'}}>{t.name}</span>
                          <button className="delete-btn" onClick={e => { e.stopPropagation(); deleteTemplate(t.id); }}>
                            <i className="ti ti-trash" />
                          </button>
                        </div>
                        {t.description && <div style={{fontSize:'12px',color:'var(--muted)',marginTop:'2px'}}>{t.description}</div>}
                        <div className="template-steps">{t.steps.length} lépés · {selectedTemplates.includes(t.id) ? '✓ Kiválasztva' : 'Kattints a kiválasztáshoz'}</div>
                      </div>
                    ))}
                  </div>
                )}
                {selectedTemplates.length > 0 && (
                  <div style={{fontSize:'12px',color:'var(--accent-light)',marginTop:'.5rem'}}>
                    <i className="ti ti-check" /> {selectedTemplates.length} sablon lesz felhasználva a generálás során
                  </div>
                )}
              </div>
            )}

            {!isSignedIn ? (
              <SignUpButton mode="modal">
                <button className="analyze-btn">
                  <i className="ti ti-user-plus" />
                  Regisztrálj és generálj teszteseteket
                </button>
              </SignUpButton>
            ) : (
              <button className="analyze-btn" onClick={analyze}>
                <i className="ti ti-wand" />
                Tesztesetek generálása
              </button>
            )}
            {error && <div className="error-msg">{error}</div>}
          </div>
        </>
      )}

      {step === 'loading' && (
        <div className="main">
          <div className="loading">
            <div className="dots"><div className="dot" /><div className="dot" /><div className="dot" /></div>
            <p>{loadingText}</p>
          </div>
        </div>
      )}

      {step === 'review' && result && (
        <div className="main">
          <div className="review-header">
            <h2>Generált tesztesetek</h2>
            <div className="review-actions">
              <button className="back-btn" onClick={() => { setStep('input'); setError(''); }}>← Vissza</button>
              <button className="btn-ghost" onClick={selectAll}>Összes kijelölése</button>
              <button className="btn-ghost" onClick={deselectAll}>Összes törlése</button>
            </div>
          </div>

          {result.summary && <div className="review-summary">{result.summary}</div>}

          <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '1rem' }}>
            <strong style={{ color: 'var(--accent-light)' }}>{testCases.filter(t => t.selected).length}</strong> / {testCases.length} teszteset kijelölve
          </div>

          <div className="tc-list">
            {testCases.map(tc => (
              <div
                key={tc.id}
                className={`tc-card ${tc.selected ? 'selected' : 'deselected'}`}
                onClick={() => toggleSelect(tc.id)}
              >
                <div className="tc-top">
                  <div className="tc-checkbox">
                    {tc.selected && <i className="ti ti-check" style={{ fontSize: '11px', color: '#fff' }} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '.4rem', flexWrap: 'wrap' }}>
                      <span className="tc-id">{tc.id}</span>
                      <span className="tc-title">{tc.title}</span>
                    </div>
                    <div className="tc-meta">
                      <span className="tc-badge" style={{ background: priorityBg[tc.priority] || '#1A1D27', color: priorityColor[tc.priority] || '#8B8FA8' }}>{tc.priority}</span>
                      <span className="tc-badge" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>{tc.category}</span>
                    </div>
                    {tc.preconditions && <div className="tc-body" style={{ marginBottom: '.4rem' }}><strong style={{ color: 'var(--muted)' }}>Előfeltétel:</strong> {tc.preconditions}</div>}
                    {tc.steps && tc.steps.length > 0 && (
                      <ul className="tc-steps">
                        {tc.steps.map((s, i) => (
                          <li key={i}>
                            {typeof s === 'object' ? s.action : s}
                            {typeof s === 'object' && s.expected && (
                              <span style={{color:'var(--green)',fontSize:'12px',display:'block',marginLeft:'8px'}}>→ {s.expected}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {tc.expectedResult && typeof tc.steps[0] !== 'object' && (
                      <div className="tc-expected">
                        <i className="ti ti-circle-check" />
                        {tc.expectedResult}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {error && <div className="error-msg">{error}</div>}

          <div className="fixed-fields">
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontSize:'13px',color:'var(--muted)',fontWeight:'500'}}>Zephyr fix mezők</span>
              <button className="toggle-link" onClick={() => setShowFixedFields(!showFixedFields)}>
                {showFixedFields ? 'Elrejtés ▲' : 'Beállítás ▼'}
              </button>
            </div>
            {showFixedFields && (
              <div className="fixed-fields-grid">
                {[
                  ['Status', 'status', ['Draft','Approved','Deprecated']],
                  ['Priority', 'priority', ['Critical','High','Medium','Low']],
                  ['Test type', 'test_type', ['Functional','Performance','Security','Usability']],
                ].map(([label, key, options]) => (
                  <div key={key} className="field-group">
                    <label>{label}</label>
                    <select value={fixedFields[key]} onChange={e => setFixedFields(p => ({...p, [key]: e.target.value}))}>
                      {options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
                {[
                  ['Folder', 'folder'], ['Component', 'component'],
                  ['Labels', 'labels'], ['Owner', 'owner'],
                  ['Test set', 'test_set']
                ].map(([label, key]) => (
                  <div key={key} className="field-group">
                    <label>{label}</label>
                    <input type="text" value={fixedFields[key]} onChange={e => setFixedFields(p => ({...p, [key]: e.target.value}))} placeholder={label} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="export-bar">
            <div className="export-bar-left">
              <strong>{testCases.filter(t => t.selected).length}</strong> teszteset exportálásra kész
              {templateFile && <span style={{ marginLeft: '8px', color: 'var(--green)' }}>· {templateFile.name}</span>}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="back-btn" onClick={() => setStep('input')}>← Módosítás</button>
              <button className="export-btn" onClick={exportXLS}>
                <i className="ti ti-download" />
                Exportálás XLS-be
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
