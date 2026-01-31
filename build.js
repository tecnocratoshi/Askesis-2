const esbuild = require('esbuild');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path'); 
const http = require('http');
const { injectManifest } = require('workbox-build');
const { handleApiSync, handleApiAnalyze } = require('./scripts/dev-api-mock.js');

const isProduction = process.env.NODE_ENV === 'production';
const outdir = path.resolve(__dirname, 'public');
const toOut = (...p) => path.join(outdir, ...p);

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

const LIVE_RELOAD_SCRIPT = `
<script>
  (function() {
    const source = new EventSource('/_reload');
    source.onmessage = (e) => e.data === 'reload' && location.reload();
    source.onerror = () => setTimeout(() => location.reload(), 2000);
  })();
</script>
</body>`;

// --- LIVE RELOAD ---
const reloadClients = new Set();
let reloadTimeout = null;

function notifyLiveReload() {
    clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(() => {
        if (!reloadClients.size) return;
        console.log('🔄 Live Reload...');
        reloadClients.forEach(res => res.write('data: reload\n\n'));
    }, 100);
}

// --- BUILD LOGIC ---
async function atomicWrite(dest, content) {
    const tmp = `${dest}.tmp`;
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, dest);
}

async function copyWorkboxRuntime() {
    try {
        const src = path.resolve(__dirname, 'node_modules/workbox-sw/build/workbox-sw.js');
        await fs.copyFile(src, toOut('workbox-sw.js'));
    } catch (e) {
        console.warn('⚠️ Workbox runtime not found. Install dependencies?', e.message || e);
    }
}

async function buildServiceWorker() {
    try {
        await injectManifest({
            swSrc: path.resolve(__dirname, 'sw.js'),
            swDest: toOut('sw.js'),
            globDirectory: outdir,
            globPatterns: ['**/*.{html,js,css,json,svg,png,jpg,ico,woff2}'],
            maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
        });
    } catch (e) {
        console.warn('⚠️ Workbox injectManifest failed', e.message || e);
    }
}

async function copyStaticFiles() {
    await fs.mkdir(outdir, { recursive: true });
    
    await atomicWrite(toOut('index.html'), await fs.readFile('index.html', 'utf-8'));
    await fs.copyFile('manifest.json', toOut('manifest.json'));

    await copyWorkboxRuntime();

    const assets = ['icons', 'locales'];
    for (const asset of assets) {
        try { await fs.cp(asset, toOut(asset), { recursive: true }); } catch {}
    }
}

const esbuildOptions = {
    // REPAIR: Incluído sync-worker para que o arquivo services/sync.worker.ts seja compilado para public/sync-worker.js
    entryPoints: { 
        'bundle': 'index.tsx',
        'sync-worker': 'services/sync.worker.ts'
    },
    bundle: true,
    splitting: true,
    outdir: outdir,
    format: 'esm',
    target: 'es2020',
    minify: isProduction,
    sourcemap: !isProduction,
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development') },
    entryNames: isProduction ? 'assets/[name]-[hash]' : '[name]',
    chunkNames: isProduction ? 'assets/[name]-[hash]' : '[name]',
    assetNames: isProduction ? 'assets/[name]-[hash]' : '[name]'
};

function normalizeOutputPath(p) {
    const normalized = p.replace(/\\/g, '/');
    if (normalized.startsWith(outdir.replace(/\\/g, '/'))) {
        return path.relative(outdir, normalized).replace(/\\/g, '/');
    }
    return normalized;
}

function updateIndexHtmlWithHashedAssets(metafile) {
    if (!metafile || !metafile.outputs) return;

    const outputs = Object.entries(metafile.outputs);
    const jsEntry = outputs.find(([file, info]) => info.entryPoint === 'index.tsx' && file.endsWith('.js'));
    if (!jsEntry) return;

    const jsFile = normalizeOutputPath(jsEntry[0]);
    const cssFile = jsEntry[1].cssBundle ? normalizeOutputPath(jsEntry[1].cssBundle) : null;

    const indexPath = toOut('index.html');
    let html = fsSync.readFileSync(indexPath, 'utf-8');
    html = html.replace(/bundle\.js/g, jsFile);
    if (cssFile) html = html.replace(/bundle\.css/g, cssFile);
    fsSync.writeFileSync(indexPath, html);
}

function watchStaticFiles() {
    let isProcessing = false;
    const processChanges = async () => {
        if (isProcessing) return;
        isProcessing = true;
        try {
            await copyStaticFiles();
            await buildServiceWorker();
            notifyLiveReload();
        } finally { isProcessing = false; }
    };

    ['index.html', 'manifest.json', 'sw.js', 'icons', 'locales'].forEach(p => {
        if (!fsSync.existsSync(p)) return;
        fsSync.watch(p, { recursive: true }, (ev) => ev && processChanges()).on('error', () => {});
    });
}

// --- DEV SERVER ---
async function startDevServer() {
    const ctx = await esbuild.context({
        ...esbuildOptions,
        plugins: [{
            name: 'watch-logger',
            setup(b) {
                b.onEnd(async (r) => {
                    if (r.errors.length) return;
                    await buildServiceWorker();
                    notifyLiveReload();
                });
            }
        }]
    });
    await ctx.watch();

    http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*'); 

        if (req.url === '/_reload') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
            reloadClients.add(res);
            return req.on('close', () => reloadClients.delete(res));
        }

        if (req.url.startsWith('/api/sync')) return await handleApiSync(req, res);
        if (req.url.startsWith('/api/analyze')) return await handleApiAnalyze(req, res);

        let url = req.url.split('?')[0]; 
        const normalized = path.normalize(url).replace(/^(\.\.(\/|\\|$))+/, '');
        let filePath = toOut(normalized);

        if (!fsSync.existsSync(filePath) || fsSync.statSync(filePath).isDirectory()) {
            filePath = toOut('index.html');
        }

        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });

        if (filePath.endsWith('index.html')) {
            const html = await fs.readFile(filePath, 'utf-8');
            res.end(html.replace('</body>', LIVE_RELOAD_SCRIPT));
        } else {
            fsSync.createReadStream(filePath).pipe(res);
        }
    }).listen(8000, () => {
        console.log(`🚀 http://localhost:8000`);
        watchStaticFiles();
    });
}

(async function() {
    await fs.rm(outdir, { recursive: true, force: true });
    await copyStaticFiles();
    if (isProduction) {
        const result = await esbuild.build({ ...esbuildOptions, metafile: true });
        updateIndexHtmlWithHashedAssets(result.metafile);
        await buildServiceWorker();
    } else {
        await startDevServer();
    }
})().catch(err => { console.error(err); process.exit(1); });