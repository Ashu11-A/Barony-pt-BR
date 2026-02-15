import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const versionIndex = args.indexOf('--version');
if (versionIndex === -1 || !args[versionIndex + 1]) {
    console.error("❌ Erro: O parâmetro --version <versão> é obrigatório.");
    console.log("Exemplo: bun manage.ts --version 5.0.1 <comando>");
    process.exit(1);
}

const VERSION = args[versionIndex + 1];
const CONFIG = {
    ptDir: `Versions/${VERSION}/PT-BR`,
    enDir: `Versions/${VERSION}/EN`,
    batchFile: 'translated_batch.txt',
    relevantFilesManifest: 'relevant_files.json'
};

// Remover --version e seu valor dos argumentos para o processamento do comando
const filteredArgs = args.filter((_, i) => i !== versionIndex && i !== versionIndex + 1);
const cmd = filteredArgs[0];
const cmdArgs = filteredArgs.slice(1);

const PH_REGEX = /%[+0#-]*[\d\.]*[diuoxXfFeEgGaAcspn%]/g;

// --- UTILS ---

const IGNORED_FILES = ['ignored_books.json', 'compiled_books.json'];
const TECHNICAL_KEYS = ['img', 'icon', 'path', 'glyph', 'slot', 'internal_name', 'item_id', 'direction', 'action'];

function isTechnical(key: string, val: any): boolean {
    if (typeof val !== 'string') return true;
    if (TECHNICAL_KEYS.some(tk => key === tk || key.endsWith(`->${tk}`) || key.includes(`->${tk}->`))) return true;
    return !isTranslatable(val);
}

function getAllFiles(dir: string, exts: string[], base: string = dir): string[] {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return [];
    fs.readdirSync(dir).forEach(file => {
        if (IGNORED_FILES.includes(file)) return;
        
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            results = results.concat(getAllFiles(filePath, exts, base));
        } else {
            const ext = path.extname(file).toLowerCase();
            if (exts.includes(ext)) {
                results.push(path.relative(base, filePath));
            }
        }
    });
    return results;
}

function getFiles(dir: string, baseDir: string = dir, exts: string[] = ['.txt', '.json']): string[] {
    if (fs.existsSync(CONFIG.relevantFilesManifest)) {
        return JSON.parse(fs.readFileSync(CONFIG.relevantFilesManifest, 'utf8'));
    }
    return getAllFiles(dir, exts);
}

function parseLangFile(content: string) {
    const entries = new Map<string, string>();
    const regex = /^(\d+)\s+([\s\S]*?)#/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
        entries.set(match[1], match[2].trim());
    }
    return entries;
}

function isTranslatable(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (trimmed === '' || trimmed === 'null' || trimmed === 'DEPRECATED') return false;
    if (trimmed.length > 100) return true; // Strings longas são sempre traduzíveis
    
    // Se contém espaços e tem letras, é altamente provável que seja uma frase/texto
    if (trimmed.includes(' ') && /[a-zA-Z]/.test(trimmed)) return true;
    
    // Blacklist de caminhos e arquivos (já tratado em outras partes, mas por segurança)
    if ((trimmed.includes('/') || trimmed.includes('\\')) && !trimmed.includes(' ')) return false;
    
    // Identificadores técnicos: ALL_CAPS_WITH_UNDERSCORES (geralmente IDs)
    if (/^[A-Z0-9_]+$/.test(trimmed) && trimmed.length > 10) return false;
    
    // Se for apenas números e símbolos de pontuação/matemáticos
    if (/^[0-9\s.,%+\-!:?#$()\[\]{}]+$/.test(trimmed)) return false;
    
    // Hex colors
    if (/^#[0-9A-Fa-f]{3,6}$/.test(trimmed)) return false;
    
    // Se tem pelo menos uma letra, consideramos traduzível (ex: "Exit", "Sair", "Gold")
    return /[a-zA-Z]/.test(trimmed);
}

// --- COMMANDS ---

function verify() {
    console.log('🛡️ Iniciando Auditoria Final Ultra-Rigorosa...');
    const enFiles = getFiles(CONFIG.enDir);
    let techIssues = 0;
    let formatIssues = 0;
    let missingFiles = 0;
    const highLevelIssues: string[] = [];

    enFiles.forEach(f => {
        const ptPath = path.join(CONFIG.ptDir, f);
        const enPath = path.join(CONFIG.enDir, f);
        
        const addHighLevel = (loc: string, ptVal: string, enVal: string, reason: string) => {
            highLevelIssues.push(`---ENTRY START---\nFILE: ${f}\nPATH: ${loc}\nEN:\n${enVal}\nPT-BR (Erro):\n${ptVal}\n(Reason: ${reason})\n---ENTRY END---\n`);
        };

        if (!fs.existsSync(ptPath)) {
            console.log(`📁 [MISSING FILE] ${f}`);
            missingFiles++;
            addHighLevel('FILE_SYSTEM', 'MISSING', 'PRESENT', 'Arquivo faltando na pasta PT-BR');
            return;
        }

        const ptRaw = fs.readFileSync(ptPath, 'utf8').replace(/\r\n/g, '\n');
        const enRaw = fs.readFileSync(enPath, 'utf8').replace(/\r\n/g, '\n');

        const ptLines = ptRaw.split('\n').length;
        const enLines = enRaw.split('\n').length;
        if (ptLines !== enLines) {
            const isJson = path.extname(f) === '.json';
            const hasHighlights = ptRaw.includes('word_highlights');
            if (isJson && hasHighlights) {
                console.log(`📏 [LINES-OK] ${f}: PT=${ptLines} vs EN=${enLines} (Permitido por conter word_highlights)`);
            } else {
                console.log(`📏 [LINES] ${f}: PT=${ptLines} vs EN=${enLines}`);
                techIssues++;
                addHighLevel('FILE_STRUCTURE', `LINES: ${ptLines}`, `LINES: ${enLines}`, 'Diferença na contagem de linhas (Quebra a sincronização)');
            }
        }

        if (ptRaw.includes('\uFFFD') || /Ã[¡©ª]/.test(ptRaw)) {
            console.log(`⚠️ [ENCODING] ${f}: Mojibake detectado.`);
            techIssues++;
            addHighLevel('FILE_ENCODING', 'CONTÉM MOJIBAKE', 'N/A', 'Erro de codificação/caracteres corrompidos');
        }

        const getPh = (s: string) => {
            const matches = s.match(/%[+0#-]*[\d\.]*[diuoxXfFeEgGaAcspn]/g) || [];
            return matches.map(p => p.replace(/\s+/g, '')).sort().join(',');
        };

        if (path.extname(f) === '.json') {
            try {
                const ptObj = JSON.parse(ptRaw);
                const enObj = JSON.parse(enRaw);
                
                const checkDeep = (p: any, e: any, pth: string) => {
                    for (const key in e) {
                        const currentPath = pth ? `${pth}.${key}` : key;
                        if (p[key] === undefined) {
                            if (pth.includes('word_highlights')) continue;
                            console.log(`🚫 [MISSING KEY] ${f} -> ${currentPath}`);
                            techIssues++;
                        } else if (typeof e[key] === 'string') {
                            if (isTechnical(key, e[key])) continue;
                            const ptVal = p[key];
                            const enVal = e[key];
                            if ((!ptVal || ptVal.trim() === '') && enVal.trim() !== '') {
                                formatIssues++;
                                addHighLevel(currentPath, ptVal, enVal, 'Empty translation');
                            }
                            const ptPh = getPh(ptVal);
                            const enPh = getPh(enVal);
                            if (ptPh !== enPh) {
                                formatIssues++;
                                addHighLevel(currentPath, ptVal, enVal, `Placeholder mismatch (PT: ${ptPh} vs EN: ${enPh})`);
                            }
                        } else if (typeof e[key] === 'object' && e[key] !== null) {
                            checkDeep(p[key], e[key], currentPath);
                        }
                    }
                };
                checkDeep(ptObj, enObj, '');
            } catch (err) { techIssues++; }
        } else if (f.endsWith('en.txt')) {
            const ptEntries = parseLangFile(ptRaw);
            const enEntries = parseLangFile(enRaw);
            for (const [id, enText] of enEntries) {
                if (!ptEntries.has(id)) {
                    techIssues++;
                } else {
                    const ptText = ptEntries.get(id)!;
                    if (ptText.trim() === '' && enText.trim() !== '') {
                        formatIssues++;
                        addHighLevel(`ID ${id}`, ptText, enText, 'Empty translation');
                    }
                    const ptPh = getPh(ptText);
                    const enPh = getPh(enText);
                    if (ptPh !== enPh) {
                        formatIssues++;
                        addHighLevel(`ID ${id}`, ptText, enText, `Placeholder mismatch (PT: ${ptPh} vs EN: ${enPh})`);
                    }
                }
            }
        }
    });

    fs.writeFileSync('IssuesHighLevel.md', highLevelIssues.join('\n'), 'utf8');
    console.log('\n--- AUDITORIA FINALIZADA ---');
    console.log(`Relatório detalhado: IssuesHighLevel.md`);
    console.log(`Técnicos: ${techIssues} | Formatação: ${formatIssues}`);
}

function autoFixHighlights(obj: any) {
    if (typeof obj !== 'object' || obj === null) return;
    if (obj.text && Array.isArray(obj.word_highlights)) {
        const words = obj.text.trim().split(/\s+/);
        const wordCount = words.length;
        obj.word_highlights = obj.word_highlights
            .map((h: number) => Math.min(h, wordCount - 1))
            .filter((h: number) => h >= 0);
        // Remover duplicatas e ordenar
        obj.word_highlights = Array.from(new Set(obj.word_highlights)).sort((a: any, b: any) => a - b);
    }
    for (const k in obj) {
        if (typeof obj[k] === 'object') autoFixHighlights(obj[k]);
    }
}

function normalize() {
    console.log('⚖️ Normalizando e formatando arquivos (EN e PT-BR)...');
    const enFiles = getAllFiles(CONFIG.enDir, ['.txt', '.json']);
    
    enFiles.forEach(f => {
        const ptPath = path.join(CONFIG.ptDir, f);
        const enPath = path.join(CONFIG.enDir, f);
        
        if (!fs.existsSync(ptPath)) {
            console.log(`🆕 Criando arquivo PT-BR inicial: ${f}`);
            fs.mkdirSync(path.dirname(ptPath), { recursive: true });
            fs.copyFileSync(enPath, ptPath);
            return;
        }

        let ptRaw = fs.readFileSync(ptPath, 'utf8').replace(/\r\n/g, '\n');
        let enRaw = fs.readFileSync(enPath, 'utf8').replace(/\r\n/g, '\n');

        if (path.extname(f) === '.json') {
            try {
                const enObj = JSON.parse(enRaw);
                let ptObj;
                try { 
                    ptObj = JSON.parse(ptRaw); 
                } catch(e) {
                    console.log(`⚠️ [JSON PARSE PT] ${f}: Erro ao ler tradução atual. Pulando sincronização estrutural.`);
                    return;
                }
                
                const syncStructure = (en: any, pt: any, key: string = '') => {
                    if (typeof en === 'string') {
                        if (TECHNICAL_KEYS.includes(key)) return en;
                        if (typeof pt === 'string' && pt !== en) {
                            const enPhs = en.match(PH_REGEX) || [];
                            const ptPhs = pt.match(PH_REGEX) || [];
                            if (enPhs.length > 0 && enPhs.length === ptPhs.length) {
                                let i = 0;
                                return pt.replace(PH_REGEX, () => enPhs[i++]);
                            }
                            return pt;
                        }
                        return en;
                    } else if (Array.isArray(en)) {
                        // Preserva arrays numéricos do PT-BR (ex: word_highlights ajustados)
                        if (en.length > 0 && typeof en[0] === 'number' && Array.isArray(pt)) {
                            return pt;
                        }
                        return en.map((item, idx) => syncStructure(item, Array.isArray(pt) ? pt[idx] : undefined, key));
                    } else if (typeof en === 'object' && en !== null) {
                        const newObj: any = {};
                        for (const k in en) {
                            newObj[k] = syncStructure(en[k], (pt && typeof pt === 'object') ? pt[k] : undefined, k);
                        }
                        return newObj;
                    }
                    return en;
                };

                const syncedObj = syncStructure(enObj, ptObj);
                autoFixHighlights(syncedObj); // Aplica o fixer em todas as chaves do JSON

                let indent: any = 2;
                const indentMatch = enRaw.match(/^[ \t]+/m);
                if (indentMatch) indent = indentMatch[0];

                enRaw = JSON.stringify(enObj, null, indent);
                ptRaw = JSON.stringify(syncedObj, null, indent);
            } catch (e) {
                console.log(`❌ Erro crítico ao processar JSON: ${f} - ${e.message}`);
                return;
            }
        } else if (f.endsWith('en.txt')) {
            const ptEntries = parseLangFile(ptRaw);
            const enEntries = parseLangFile(enRaw);
            
            let newEnContent = "";
            let newPtContent = "";
            
            const sortedIds = Array.from(enEntries.keys()).sort((a, b) => parseInt(a) - parseInt(b));
            
            for (const id of sortedIds) {
                // Forçamos o texto a ser uma única linha removendo quebras de linha internas
                // O Barony geralmente aceita espaços no lugar de novas linhas ou faz o wrap automático
                const enText = enEntries.get(id)!.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
                const ptText = (ptEntries.get(id) || enText).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
                
                newEnContent += `${id} ${enText}#\n`;
                newPtContent += `${id} ${ptText}#\n`;
            }
            enRaw = newEnContent;
            ptRaw = newPtContent;
            console.log(`📝 Normalizando TXT (One-Line-Per-Entry): ${f} (${sortedIds.length} entradas)`);
        }

        // Salva ambos com CRLF para manter consistência no Windows
        fs.writeFileSync(enPath, enRaw.replace(/\n/g, '\r\n'), 'utf8');
        fs.writeFileSync(ptPath, ptRaw.replace(/\n/g, '\r\n'), 'utf8');
    });
}

function identify() {
    console.log('🔍 Identificando arquivos relevantes...');
    const files = getAllFiles(CONFIG.enDir, ['.txt', '.json']);
    const relevantFiles: string[] = [];
    files.forEach(f => {
        const fullPath = path.join(CONFIG.enDir, f);
        const content = fs.readFileSync(fullPath, 'utf8');
        let relevant = false;
        if (f.endsWith('.json')) {
            try {
                const scan = (obj: any): boolean => {
                    if (typeof obj === 'string') return isTranslatable(obj);
                    if (Array.isArray(obj)) return obj.some(scan);
                    if (typeof obj === 'object' && obj !== null) return Object.values(obj).some(scan);
                    return false;
                };
                relevant = scan(JSON.parse(content));
            } catch (e) {}
        } else {
            relevant = content.split('#').some(piece => {
                const match = piece.match(/^\s*\d+\s+([\s\S]*)$/);
                return match && isTranslatable(match[1]);
            }) || isTranslatable(content);
        }
        if (relevant) relevantFiles.push(f);
    });
    fs.writeFileSync(CONFIG.relevantFilesManifest, JSON.stringify(relevantFiles, null, 2));
    console.log(`✅ ${relevantFiles.length} arquivos relevantes.`);
}

function align() {
    console.log('⚖️ Alinhando placeholders...');
    const files = getFiles(CONFIG.enDir);
    files.forEach(f => {
        const ptPath = path.join(CONFIG.ptDir, f);
        const enPath = path.join(CONFIG.enDir, f);
        if (!fs.existsSync(ptPath) || !f.endsWith('.json')) return;
        const pt = JSON.parse(fs.readFileSync(ptPath, 'utf8'));
        const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
        const alignStr = (ptStr: string, enStr: string): string => {
            let alignedPt = ptStr;
            const enPhs = enStr.match(PH_REGEX) || [];
            const ptPhs = alignedPt.match(PH_REGEX) || [];
            if (enPhs.length > 0 && enPhs.length === ptPhs.length) {
                let i = 0;
                return alignedPt.replace(PH_REGEX, () => enPhs[i++]);
            }
            return alignedPt;
        };
        const walk = (p: any, e: any) => {
            for (const k in e) {
                if (p[k] === undefined) continue;
                if (typeof e[k] === 'string' && typeof p[k] === 'string') p[k] = alignStr(p[k], e[k]);
                else if (typeof e[k] === 'object' && e[k] !== null) walk(p[k], e[k]);
            }
        };
        walk(pt, en);
        fs.writeFileSync(ptPath, JSON.stringify(pt, null, 2), 'utf8');
    });
}

function findUntranslated() {
    console.log('🔎 Buscando strings não traduzidas em todos os arquivos relevantes...');
    const files = getFiles(CONFIG.enDir);
    let totalUntranslated = 0;
    let report = `# Relatório de Strings Não Traduzidas\nData: ${new Date().toLocaleString()}\n\n`;

    files.forEach(f => {
        const enPath = path.join(CONFIG.enDir, f);
        const ptPath = path.join(CONFIG.ptDir, f);
        if (!fs.existsSync(ptPath)) return;

        const enRaw = fs.readFileSync(enPath, 'utf8').replace(/\r\n/g, '\n');
        const ptRaw = fs.readFileSync(ptPath, 'utf8').replace(/\r\n/g, '\n');
        let fileUntranslated = 0;
        let fileEntries = '';

        if (f.endsWith('.json')) {
            try {
                const enObj = JSON.parse(enRaw);
                const ptObj = JSON.parse(ptRaw);
                const walk = (e: any, p: any, pth: string) => {
                    if (typeof e === 'string' && isTranslatable(e)) {
                        if (e === p) {
                            fileEntries += `| ${pth} | ${e.replace(/\|/g, '\\|')} |\n`;
                            fileUntranslated++;
                        }
                    } else if (Array.isArray(e)) {
                        e.forEach((item, idx) => walk(item, p && p[idx], `${pth}[${idx}]`));
                    } else if (typeof e === 'object' && e !== null) {
                        for (const k in e) {
                            walk(e[k], p && p[k], pth ? `${pth}->${k}` : k);
                        }
                    }
                };
                walk(enObj, ptObj, '');
            } catch (err) {}
        } else if (f.endsWith('en.txt')) {
            const enEntries = parseLangFile(enRaw);
            const ptEntries = parseLangFile(ptRaw);
            for (const [id, enText] of enEntries) {
                if (isTranslatable(enText) && enText === ptEntries.get(id)) {
                    fileEntries += `| ID ${id} | ${enText.replace(/\|/g, '\\|')} |\n`;
                    fileUntranslated++;
                }
            }
        }

        if (fileUntranslated > 0) {
            report += `## Arquivo: ${f} (${fileUntranslated} pendentes)\n`;
            report += `| Path/ID | Texto Original |\n|---|---|\n${fileEntries}\n`;
            totalUntranslated += fileUntranslated;
        }
    });

    fs.writeFileSync('untranslated_report.txt', report, 'utf8');
    console.log(`✅ Relatório gerado: untranslated_report.txt (${totalUntranslated} strings pendentes)`);
}

function findMojibake() {
    console.log('🧐 Buscando Mojibake...');
    const content = fs.readFileSync(path.join(CONFIG.ptDir, 'lang/en.txt'), 'utf8');
    const lines = content.split('\n');
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
        if (/Ã[\u0080-\u00BF]/.test(lines[i])) {
            console.log(`L${i + 1}: ${lines[i].trim()}`);
            count++;
        }
    }
    console.log(`Total: ${count}`);
}

function checkSizes() {
    console.log('📊 Validando tamanhos...');
    const files = getFiles(CONFIG.enDir);
    console.log('| Arquivo | EN | PT | % |');
    files.forEach(f => {
        const ptPath = path.join(CONFIG.ptDir, f);
        const enPath = path.join(CONFIG.enDir, f);
        if (fs.existsSync(ptPath) && fs.existsSync(enPath)) {
            const ptSize = fs.statSync(ptPath).size;
            const enSize = fs.statSync(enPath).size;
            const ratio = enSize > 0 ? (ptSize / enSize) : 1;
            if (ratio < 0.8 || ratio > 2.5) {
                console.log(`| ${f} | ${enSize} | ${ptSize} | ${(ratio * 100).toFixed(1)}% |`);
            }
        }
    });
}

// --- APPLY LOGIC ---

function updateJson(filePath: string, jsonPath: string, newValue: string) {
    const fullPath = path.join(CONFIG.ptDir, filePath);
    if (!fs.existsSync(fullPath)) return false;
    let json;
    try { json = JSON.parse(fs.readFileSync(fullPath, 'utf8')); } catch (e) { json = {}; }
    
    // Novo separador '->' para evitar conflito com espaços ou pontos nas chaves
    const parts = jsonPath.includes('->') ? jsonPath.split('->') : jsonPath.split('.');
    console.log(`DEBUG: jsonPath parts: ${JSON.stringify(parts)}`);
    
    let curr = json;
    for (let i = 0; i < parts.length - 1; i++) {
        let part = parts[i].trim();
        const m = part.match(/^(.+)\[(\d+)\]$/);
        if (m) {
            const prop = m[1]; const idx = parseInt(m[2]);
            if (!curr[prop]) curr[prop] = [];
            if (!curr[prop][idx]) curr[prop][idx] = {};
            curr = curr[prop][idx];
        } else {
            if (!curr[part] || typeof curr[part] !== 'object') curr[part] = {};
            curr = curr[part];
        }
    }
    const last = parts[parts.length - 1].trim();
    const m = last.match(/^(.+)\[(\d+)\]$/);
    if (m) {
        const prop = m[1]; const idx = parseInt(m[2]);
        if (!curr[prop]) curr[prop] = [];
        while (curr[prop].length <= idx) curr[prop].push(null);
        curr[prop][idx] = newValue;
    } else { curr[last] = newValue; }
    
    // Salva com a indentação detectada do original
    const enPath = path.join(CONFIG.enDir, filePath);
    let indent = 2;
    if (fs.existsSync(enPath)) {
        const enRaw = fs.readFileSync(enPath, 'utf8');
        const indentMatch = enRaw.match(/^[ \t]+/m);
        if (indentMatch) indent = indentMatch[0];
    }
    
    fs.writeFileSync(fullPath, JSON.stringify(json, null, indent), 'utf8');
    return true;
}

function updateTxt(filePath: string, id: string, newValue: string) {
    const fullPath = path.join(CONFIG.ptDir, filePath);
    if (!fs.existsSync(fullPath)) return false;
    let content = fs.readFileSync(fullPath, 'utf8');
    const regex = new RegExp(`(^|\\r?\\n)${id}\\s+([\\s\\S]*?)#`, 'm');
    if (regex.test(content)) {
        content = content.replace(regex, (match, p1) => `${p1}${id} ${newValue}#`);
    } else {
        content = content.trimEnd() + `\n\n${id} ${newValue}#\n`;
    }
    fs.writeFileSync(fullPath, content, 'utf8');
    return true;
}

function apply() {
    if (!fs.existsSync(CONFIG.batchFile)) {
        console.log('Arquivo de lote não encontrado.');
        return;
    }
    const content = fs.readFileSync(CONFIG.batchFile, 'utf8');
    console.log(`DEBUG: Batch content length: ${content.length}`);
    const entries = content.split('---ENTRY START---').filter(e => e.trim());
    for (const entry of entries) {
        const lines = entry.split(/\n|\r\n/).map(l => l.trim()).filter(l => l);
        let file = '', jsonPath = '', id = '', pt = '';
        for (const line of lines) {
            if (line.startsWith('FILE:')) file = line.substring(5).trim();
            else if (line.startsWith('PATH:')) jsonPath = line.substring(5).trim();
            else if (line.startsWith('ID:')) id = line.substring(3).trim();
            else if (line.startsWith('PT-BR:')) {
                const ptStart = entry.indexOf('PT-BR:') + 6;
                const ptEnd = entry.indexOf('---ENTRY END---');
                pt = entry.substring(ptStart, ptEnd).trim();
                break;
            }
        }
        if (file && pt) {
            if (jsonPath) {
                console.log(`DEBUG: Calling updateJson with jsonPath: [${jsonPath}]`);
                if (updateJson(file, jsonPath, pt)) console.log(`✅ JSON: ${file} -> ${JSON.stringify(jsonPath)}`);
            } else if (id) {
                if (updateTxt(file, id, pt)) console.log(`✅ TXT: ${file} -> ID ${id}`);
            } else {
                // Suporte para substituição completa de arquivo (ex: livros .txt)
                const fullPath = path.join(CONFIG.ptDir, file);
                if (fs.existsSync(fullPath)) {
                    fs.writeFileSync(fullPath, pt, 'utf8');
                    console.log(`✅ FILE: ${file} (Full replacement)`);
                }
            }
        }
    }
    fs.writeFileSync(CONFIG.batchFile, '', 'utf8');
    console.log(`\n✨ Lote aplicado e ${CONFIG.batchFile} limpo.`);
}

function clean() {
    console.log('🧹 Limpando arquivos não permitidos e buscando redundâncias...');
    
    const allowedExts = ['.txt', '.ttf', '.json'];
    let removed = 0;

    const dirs = [
        { path: CONFIG.enDir, name: 'EN' },
        { path: CONFIG.ptDir, name: 'PT-BR' }
    ];

    dirs.forEach(d => {
        if (!fs.existsSync(d.path)) return;
        const files = getAllFiles(d.path, ['.txt', '.json', '.ttf', '.png', '.vox', '.ogg', '.ogv', '.bak', '.zip', '.ttf']); 
        files.forEach(f => {
            const filePath = path.join(d.path, f);
            if (!fs.existsSync(filePath)) return;

            const ext = path.extname(f).toLowerCase();

            if (!allowedExts.includes(ext)) {
                console.log(`🗑️ Removendo (extensão inválida) em ${d.name}: ${f}`);
                fs.unlinkSync(filePath);
                removed++;
            } else if (d.path === CONFIG.ptDir && (ext === '.txt' || ext === '.json')) {
                const enPath = path.join(CONFIG.enDir, f);
                if (!fs.existsSync(enPath)) {
                    console.log(`🗑️ Removendo órfão em PT-BR: ${f}`);
                    fs.unlinkSync(filePath);
                    removed++;
                }
            }
        });
    });
    console.log(`✅ Limpeza de arquivos concluída. ${removed} arquivos removidos.`);
    checkRedundancy();
}

function checkRedundancy() {
    console.log('🔍 Analisando arquivos para NoChanges.md...');
    const enFiles = getAllFiles(CONFIG.enDir, ['.txt', '.json']);
    const redundant: string[] = [];
    const noTranslatable: string[] = [];

    enFiles.forEach(f => {
        const enPath = path.join(CONFIG.enDir, f);
        const ptPath = path.join(CONFIG.ptDir, f);
        
        const enRaw = fs.readFileSync(enPath, 'utf8');
        let hasTranslatable = false;

        if (f.endsWith('.json')) {
            try {
                const scan = (obj: any): boolean => {
                    if (typeof obj === 'string') return isTranslatable(obj);
                    if (Array.isArray(obj)) return obj.some(scan);
                    if (typeof obj === 'object' && obj !== null) return Object.values(obj).some(scan);
                    return false;
                };
                hasTranslatable = scan(JSON.parse(enRaw));
            } catch (e) {}
        } else {
            hasTranslatable = enRaw.split('#').some(piece => {
                const match = piece.match(/^\s*\d+\s+([\s\S]*)$/);
                return match && isTranslatable(match[1]);
            }) || isTranslatable(enRaw);
        }

        if (!hasTranslatable) {
            noTranslatable.push(f);
        } else if (fs.existsSync(ptPath)) {
            const ptRaw = fs.readFileSync(ptPath, 'utf8');
            if (enRaw.replace(/\r\n/g, '\n').trim() === ptRaw.replace(/\r\n/g, '\n').trim()) {
                redundant.push(f);
            }
        }
    });

    let mdContent = '# Arquivos para Validação Manual (NoChanges)\n\n';
    mdContent += 'Estes arquivos foram detectados como possivelmente desnecessários.\n';
    mdContent += '**Instrução:** Marque com `[x]` os arquivos que deseja remover definitivamente de EN e PT-BR e execute `bun manage.ts purge`.\n\n';
    
    mdContent += '## 🚫 Sem Texto Traduzível (Sugestão: Remover)\n';
    noTranslatable.forEach(f => mdContent += `- [ ] ${f}\n`);
    
    mdContent += '\n## ⚖️ Idênticos ao Original (EN == PT-BR)\n';
    redundant.forEach(f => mdContent += `- [ ] ${f}\n`);

    fs.writeFileSync('NoChanges.md', mdContent, 'utf8');
    console.log(`✅ Relatório NoChanges.md gerado com ${noTranslatable.length + redundant.length} sugestões.`);
}

function purge() {
    if (!fs.existsSync('NoChanges.md')) {
        console.log('❌ NoChanges.md não encontrado. Execute clean primeiro.');
        return;
    }
    console.log('🗑️ Iniciando remoção de arquivos validados...');
    const content = fs.readFileSync('NoChanges.md', 'utf8');
    const lines = content.split(/\r?\n/);
    let removed = 0;
    
    for (const line of lines) {
        if (line.startsWith('- [x] ')) {
            const file = line.substring(6).trim();
            const enPath = path.join(CONFIG.enDir, file);
            const ptPath = path.join(CONFIG.ptDir, file);
            
            let fileRemoved = false;
            if (fs.existsSync(enPath)) { fs.unlinkSync(enPath); fileRemoved = true; }
            if (fs.existsSync(ptPath)) { fs.unlinkSync(ptPath); fileRemoved = true; }
            
            if (fileRemoved) {
                console.log(`✅ Removido: ${file}`);
                removed++;
            }
        }
    }
    console.log(`\n✨ Purge concluído. ${removed} arquivos removidos das pastas EN e PT-BR.`);
}

function compare() {
    console.log('🔍 Gerando Compared.md para revisão profunda...');
    const enFiles = getAllFiles(CONFIG.enDir, ['.txt', '.json']);
    let mdContent = '# Comparação de Tradução (Revisão Manual)\n\n';
    mdContent += 'Instruções: Remova os itens que estão CORRETOS. Deixe apenas os que precisam de correção no campo PT-BR:.\n\n';

    enFiles.forEach(f => {
        const enPath = path.join(CONFIG.enDir, f);
        const ptPath = path.join(CONFIG.ptDir, f);
        if (!fs.existsSync(ptPath)) return;

        const enRaw = fs.readFileSync(enPath, 'utf8').replace(/\r\n/g, '\n');
        const ptRaw = fs.readFileSync(ptPath, 'utf8').replace(/\r\n/g, '\n');

        let fileEntries = '';

        if (f.endsWith('.json')) {
            try {
                const enObj = JSON.parse(enRaw);
                const ptObj = JSON.parse(ptRaw);

                const walk = (e: any, p: any, pth: string) => {
                    if (typeof e === 'string' && isTranslatable(e)) {
                        const ptVal = (p !== undefined && p !== null) ? p : '(MISSING/INVALID)';
                        fileEntries += `---ENTRY---\nFILE: ${f}\nPATH: ${pth}\nEN: ${e}\nPT-BR: ${ptVal}\n\n`;
                    } else if (Array.isArray(e)) {
                        e.forEach((item, idx) => walk(item, p && p[idx], `${pth}[${idx}]`));
                    } else if (typeof e === 'object' && e !== null) {
                        for (const k in e) {
                            walk(e[k], p && p[k], pth ? `${pth}->${k}` : k);
                        }
                    }
                };
                walk(enObj, ptObj, '');
            } catch (err) {}
        } else if (f.endsWith('en.txt')) {
            const enEntries = parseLangFile(enRaw);
            const ptEntries = parseLangFile(ptRaw);
            for (const [id, enText] of enEntries) {
                if (isTranslatable(enText)) {
                    const ptText = ptEntries.get(id) || '(MISSING)';
                    fileEntries += `---ENTRY---\nFILE: ${f}\nID: ${id}\nEN: ${enText}\nPT-BR: ${ptText}\n\n`;
                }
            }
        } else if (f.endsWith('.txt')) {
            // Arquivos de texto puro (como livros)
            fileEntries += `---ENTRY---\nFILE: ${f}\nEN:\n${enRaw}\nPT-BR:\n${ptRaw}\n\n`;
        }

        if (fileEntries) {
            mdContent += `## FILE: ${f}\n\n${fileEntries}---\n\n`;
        }
    });

    fs.writeFileSync('Compared.md', mdContent, 'utf8');
    console.log('✅ Compared.md gerado com sucesso.');
}

function check(paths: string[]) {
    let allFiles: string[] = [];
    
    paths.forEach(p => {
        if (!fs.existsSync(p)) {
            console.log(`⚠️ Caminho não encontrado: ${p}`);
            return;
        }
        if (fs.statSync(p).isDirectory()) {
            allFiles = allFiles.concat(getAllFiles(p, ['.json', '.txt']).map(f => path.join(p, f)));
        } else {
            allFiles.push(p);
        }
    });

    if (allFiles.length === 0) {
        console.log('❌ Nenhum arquivo válido para processar.');
        return;
    }

    let mdContent = `# Relatório de Check\n\n`;
    mdContent += `Data: ${new Date().toLocaleString()}\n\n`;
    mdContent += '> [!CAUTION]\n';
    mdContent += '> **AVISO DE INTEGRIDADE:** Analise cuidadosamente o contexto antes de traduzir.\n';
    mdContent += '> NÃO traduza campos técnicos como IDs, categorias de sistema, slots de equipamento ou valores fixos de estatísticas (blacklist no GEMINI.md).\n';
    mdContent += '> Se o campo parecer uma chave de configuração interna, mantenha o valor original.\n\n';

    allFiles.forEach(filePath => {
        console.log(`🔍 Processando ${filePath}...`);
        const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
        mdContent += `## Arquivo: ${filePath}\n\n`;
        
        if (filePath.endsWith('.json')) {
            mdContent += '| Linha | Arquivo | Path | Valor |\n';
            mdContent += '|-------|---------|------|-------|\n';
            try {
                const obj = JSON.parse(raw);
                const lines = raw.split('\n');
                const walk = (o: any, pth: string) => {
                    const parts = pth.split('->');
                    const lastKey = parts[parts.length - 1].replace(/\[\d+\]$/, '');
                    if (typeof o === 'string' && !isTechnical(lastKey, o)) {
                        const searchStr = JSON.stringify(o);
                        const lineIndex = lines.findIndex(l => l.includes(searchStr));
                        const escapedValue = o.replace(/\|/g, '\\|');
                        mdContent += `| ${lineIndex + 1} | ${filePath} | ${pth} | ${escapedValue} |\n`;
                    } else if (Array.isArray(o)) {
                        o.forEach((item, idx) => walk(item, `${pth}[${idx}]`));
                    } else if (typeof o === 'object' && o !== null) {
                        for (const k in o) {
                            walk(o[k], pth ? `${pth}->${k}` : k);
                        }
                    }
                };
                walk(obj, '');
            } catch (e) {
                mdContent += `| ERROR | - | Falha ao processar JSON: ${e.message} |\n`;
            }
        } else if (filePath.endsWith('en.txt')) {
            mdContent += '| ID | Valor |\n|----|-------|\n';
            const entries = parseLangFile(raw);
            for (const [id, text] of entries) {
                if (isTranslatable(text)) {
                    mdContent += `| ${id} | ${text.replace(/\|/g, '\\|')} |\n`;
                }
            }
        } else if (filePath.endsWith('.txt')) {
            mdContent += '```text\n' + raw + '\n```\n';
        }
        mdContent += '\n---\n\n';
    });

    fs.writeFileSync('Check.md', mdContent, 'utf8');
    console.log(`✅ Check.md gerado com sucesso com ${allFiles.length} arquivos.`);
}

function update() {
    const BARONY_ROOT = "C:/Program Files (x86)/Steam/steamapps/common/Barony";
    
    // Find latest version
    const versionsDir = 'Versions';
    if (!fs.existsSync(versionsDir)) {
        console.log(`❌ Pasta ${versionsDir} não encontrada.`);
        return;
    }

    const versions = fs.readdirSync(versionsDir)
        .filter(f => fs.statSync(path.join(versionsDir, f)).isDirectory())
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    if (versions.length === 0) {
        console.log("❌ Nenhuma pasta de versão encontrada em Versions/");
        return;
    }

    const latestVersion = versions[0];
    const enDir = path.join(versionsDir, latestVersion, 'EN');

    if (!fs.existsSync(enDir)) {
        console.log(`❌ Pasta EN não encontrada para a versão ${latestVersion}: ${enDir}`);
        return;
    }

    console.log(`📂 Usando versão mais recente: ${latestVersion}`);
    const files = getAllFiles(enDir, ['.txt', '.json', '.ttf']);

    console.log(`🔄 Sincronizando ${files.length} arquivos com a pasta original do Barony...`);

    files.forEach((f: string) => {
        const destPath = path.join(enDir, f);
        const srcPath = path.resolve(BARONY_ROOT, f);

        if (fs.existsSync(srcPath)) {
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            fs.copyFileSync(srcPath, destPath);
            console.log(`✅ Copiado: ${f}`);
        } else {
            console.warn(`⚠️ Origem não encontrada: ${srcPath}`);
        }
    });

    console.log("✨ Sincronização concluída com sucesso.");
}

// --- CLI ---

function showHelp() {
    console.log(`
🚀 Gerenciador de Tradução - Gemini CLI

Uso: bun manage.ts --version <versão> <comando>

Comandos disponíveis:

  identify       🔍 Escaneia a pasta EN para encontrar arquivos com textos traduzíveis.
                 Gera o manifesto 'relevant_files.json'.

  update         🔄 Sincroniza os arquivos da pasta EN da versão especificada com os originais do jogo (Barony).

  verify         🛡️ Auditoria Final: Mojibake, Placeholders, Chaves e Paridade.
                 Gera o relatório 'IssuesHighLevel.md'.

  apply          ✅ Aplica traduções do 'translated_batch.txt'.

  clean          🧹 Limpa extensões inválidas e gera o relatório 'NoChanges.md'.
  
  purge          🗑️ Remove definitivamente os arquivos marcados em 'NoChanges.md'.

  compare        🔍 Gera 'Compared.md' para revisão manual de todas as strings.

  untranslated   🔎 Busca strings não traduzidas no 'lang/en.txt'.

  lint           ✨ Sincronização, Limpeza e Alinhamento de estrutura.

  check <paths>  🔍 Lista strings traduzíveis de arquivos ou pastas JSON em Check.md.

Exemplos: 
  bun manage.ts --version 5.0.1 lint
  bun manage.ts --version 5.0.1 check Versions/5.0.1/EN/data
    `);
}

switch (cmd) {
    case 'identify': identify(); break;
    case 'update': update(); break;
    case 'verify': verify(); break;
    case 'apply': apply(); break;
    case 'untranslated': findUntranslated(); break;
    case 'mojibake': findMojibake(); break;
    case 'size': checkSizes(); break;
    case 'purge': purge(); break;
    case 'clean': clean(); break;
    case 'compare': compare(); break;
    case 'check':
        if (cmdArgs.length === 0) {
            console.log(`Uso: bun ./manage.ts --version ${VERSION} check <filepath ou folderpath> [...]`);
        } else {
            check(cmdArgs);
        }
        break;
    case 'lint':
        console.log(`✨ Iniciando Sincronização e Limpeza Completa (LINT) para versão ${VERSION}...`);
        clean();
        normalize();
        console.log('✅ LINT concluído com sucesso.');
        break;
    default: showHelp();
}
