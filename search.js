// Importiere die nötigen Bibliotheken
const axios = require('axios');
const cheerio = require('cheerio');

// Diese Funktion wird von Vercel aufgerufen, wenn jemand /api/search aufruft
module.exports = async (req, res) => {
    // Erlaube Anfragen von jeder Webseite (CORS-Header)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Bei einer OPTIONS-Anfrage (Preflight) einfach mit OK antworten
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Hole den Suchbegriff aus der URL (z.B. /api/search?q=benchy)
    const { q } = req.query;

    if (!q) {
        return res.status(400).json({ error: 'Suchbegriff (q) fehlt.' });
    }

    try {
        // Starte alle Suchen parallel, um Zeit zu sparen.
        // Promise.allSettled wartet auf alle, auch wenn eine fehlschlägt.
        const results = await Promise.allSettled([
            searchPrintables(q),
            searchThingiverse(q),
            searchMakerworld(q)
        ]);

        // Filtere die Ergebnisse: Nimm nur die erfolgreichen Suchen
        // und kombiniere ihre Ergebnisse in einem einzigen Array.
        const successfulResults = results
            .filter(result => result.status === 'fulfilled' && Array.isArray(result.value))
            .flatMap(result => result.value);

        // Mische die Ergebnisse, damit nicht immer nur eine Plattform oben steht
        successfulResults.sort(() => Math.random() - 0.5);

        res.status(200).json(successfulResults);

    } catch (error) {
        res.status(500).json({ error: 'Ein interner Fehler ist aufgetreten.' });
    }
};

// --- Suchfunktionen für die einzelnen Plattformen ---

async function searchPrintables(query) {
    const response = await axios.post('https://api.printables.com/graphql', {
        query: `
            query FileSearch($query: String!) {
                search(input: { term: $query, scope: MODEL, limit: 15 }) {
                    ... on ModelSearch {
                        total
                        hits {
                            ... on ModelHit {
                                score
                                object {
                                    id
                                    name
                                    primaryImage { url }
                                    user { name }
                                    slug
                                }
                            }
                        }
                    }
                }
            }
        `,
        variables: { query }
    });

    return response.data.data.search.hits.map(hit => ({
        title: hit.object.name,
        url: `https://www.printables.com/model/${hit.object.id}-${hit.object.slug}`,
        imageUrl: hit.object.primaryImage.url.replace(/(\/(\d+))$/, '/256'), // Bildgröße anpassen
        source: 'Printables',
        author: hit.object.user.name
    }));
}

async function searchThingiverse(query) {
    // Deinen API-Token holst du aus den "Environment Variables" von Vercel
    const THINGIVERSE_TOKEN = process.env.THINGIVERSE_TOKEN;
    const response = await axios.get(`https://api.thingiverse.com/search/${encodeURIComponent(query)}?access_token=${THINGIVERSE_TOKEN}`);

    // Limitiere auf 15 Ergebnisse, um die Datenmenge zu steuern
    return response.data.hits.slice(0, 15).map(hit => ({
        title: hit.name,
        url: hit.public_url,
        imageUrl: hit.thumbnail,
        source: 'Thingiverse',
        author: hit.creator.name
    }));
}

async function searchMakerworld(query) {
    // Hier passiert das "Scraping"
    const response = await axios.get(`https://makerworld.com/de/search?keyword=${encodeURIComponent(query)}`, {
        // Wir tun so, als wären wir ein normaler Browser
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
    });

    const $ = cheerio.load(response.data);
    const results = [];

    // ACHTUNG: Diese "Selektoren" können sich ändern, wenn Makerworld seine Webseite umbaut!
    $('.card-item-hover-box.model-item').each((i, el) => {
        const title = $(el).find('.model-title a').text().trim();
        const url = 'https://makerworld.com' + $(el).find('.model-title a').attr('href');
        // Lazy-loading Bild aus dem data-src Attribut holen
        const imageUrl = $(el).find('.image-box .img-box img').attr('data-src');
        const author = $(el).find('.author-name a').text().trim();

        if (title && url && imageUrl) {
             results.push({
                title,
                url,
                imageUrl,
                source: 'Makerworld',
                author
            });
        }
    });

    return results.slice(0, 15);
}