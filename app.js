const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const path = require('path');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const statistic = require('./statistic');

// Wczytywanie .env lokalnie (Vercel używa zmiennych środowiskowych z panelu)
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const MONGODB_URI = process.env.MONGODB_URI;

// ----------------------------------------------------------------
// OPTYMALIZACJA POŁĄCZENIA Z BAZĄ DLA VERCEL (SERVERLESS)
// ----------------------------------------------------------------
// W środowisku serverless (Vercel) zmienne globalne są zachowywane między wywołaniami.
// Dzięki temu nie otwieramy nowego połączenia przy każdym kliknięciu.

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectToMongo() {
    if (cached.conn) {
        return cached.conn;
    }

    if (!cached.promise) {
        const opts = {
            bufferCommands: false, // Ważne dla serverless
        };

        cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
            return mongoose;
        });
    }
    
    try {
        cached.conn = await cached.promise;
    } catch (e) {
        cached.promise = null;
        throw e;
    }

    return cached.conn;
}

// Definicja Schematu
const susResultSchema = new mongoose.Schema({
    nickname: { type: String, required: true, trim: true },
    timestamp: { type: Date, default: Date.now },
    susScore: { type: Number, required: true },
    responses: { type: [Number], required: true }
});

// Zapobiegamy błędowi ponownej kompilacji modelu przy "gorącym przeładowaniu" w dev
const SusResult = mongoose.models.SusResult || mongoose.model('SusResult', susResultSchema);

// Konfiguracja Express
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views')); // Bezpieczniejsza ścieżka dla Vercel
app.use(express.urlencoded({ extended: true }));
// Obsługa plików statycznych (css, obrazy) - jeśli masz folder public
app.use(express.static(path.join(__dirname, 'public')));

// Pytania SUS
const SUS_QUESTIONS = [
    { text: "Będę często korzystał/a z tej gry.", isPositive: true },
    { text: "Gra jest niepotrzebnie skomplikowana.", isPositive: false },
    { text: "Uważam, że gra jest łatwa w użyciu.", isPositive: true },
    { text: "Myślę, że będę potrzebował/a wsparcia technicznego, aby korzystać z tej gry.", isPositive: false },
    { text: "Różne funkcje w grze są łatwo dostępne.", isPositive: true },
    { text: "W grze jest zbyt wiele niespójności.", isPositive: false },
    { text: "Większość osób będzie w stanie opanować grę bardzo szybko.", isPositive: true },
    { text: "Uważam grę za kłopotliwą w użyciu.", isPositive: false },
    { text: "Czuję się bardzo pewnie, korzystając z gry.", isPositive: true },
    { text: "Musiałem/am opanować wiele rzeczy przed rozpoczęciem pracy z grą.", isPositive: false }
];

// --- FUNKCJE LOGICZNE ---
function calculateSusScore(responses) {
    let totalPoints = 0;
    let completedQuestions = 0;
    SUS_QUESTIONS.forEach((question, index) => {
        const val = responses[`q${index}`];
        const N = val ? parseInt(val, 10) : 0;
        if (N >= 1 && N <= 5) {
            completedQuestions++;
            let points = question.isPositive ? N - 1 : 5 - N;
            totalPoints += points;
        }
    });
    if (completedQuestions !== SUS_QUESTIONS.length) return null;
    return Math.round(totalPoints * 2.5 * 10) / 10;
}

function interpretSusScore(score) {
    if (score >= 80.3) return { rating: "Znakomity (Excellent)", grade: "A" };
    if (score >= 70.0) return { rating: "Dobry (Good)", grade: "B" };
    if (score >= 68.0) return { rating: "Neutralny/OK", grade: "C" };
    if (score >= 50.0) return { rating: "Przeciętny (Below Average)", grade: "D" };
    return { rating: "Słaby/Nieakceptowalny (Poor)", grade: "F" };
}

// --- TRASY ---

// Middleware: Upewnij się, że baza jest połączona przed każdym żądaniem
app.use(async (req, res, next) => {
    await connectToMongo();
    next();
});

app.get('/', (req, res) => {
    const error = req.query.error || null;
    res.render('index', { error });
});

app.get('/survey', (req, res) => {
    const nickname = req.query.nickname || null;
    if (!nickname || nickname.trim() === '') {
        const msg = encodeURIComponent('Pseudonim jest wymagany.');
        return res.redirect(`/?error=${msg}`);
    }
    res.render('survey', { questions: SUS_QUESTIONS, susScore: null, error: null, nickname, susInterpretation: null });
});

app.post('/start', (req, res) => {
    const nickname = req.body.nickname;
    if (!nickname || nickname.trim() === '') {
        return res.render('index', { error: "Pseudonim jest wymagany." });
    }
    res.redirect(`/survey?nickname=${encodeURIComponent(nickname)}`);
});

app.post('/survey', async (req, res) => {
    const susScore = calculateSusScore(req.body);
    const nickname = req.body.nickname;
    if (!nickname || nickname.trim() === '') {
        const msg = encodeURIComponent('Pseudonim jest wymagany.');
        return res.redirect(`/?error=${msg}`);
    }
    if (susScore === null) {
        return res.render('survey', { questions: SUS_QUESTIONS, susScore: null, error: "Proszę odpowiedzieć na wszystkie pytania.", nickname: nickname, susInterpretation: null });
    }

    const interpretation = interpretSusScore(susScore);

    try {
        const responsesArray = [];
        for (let i = 0; i < SUS_QUESTIONS.length; i++) {
            responsesArray.push(parseInt(req.body[`q${i}`], 10));
        }
        const newResult = new SusResult({ nickname, susScore, responses: responsesArray });
        await newResult.save();
    } catch (e) {
        console.error("Błąd zapisu:", e);
        return res.status(500).render('survey', { questions: SUS_QUESTIONS, susScore: susScore, susInterpretation: interpretation, error: "Błąd zapisu do bazy.", nickname: nickname });
    }
    res.render('survey', { questions: SUS_QUESTIONS, susScore: susScore, susInterpretation: interpretation, error: null, nickname: nickname });
});

app.get('/results', async (req, res) => {
    try {
        const rawResults = await SusResult.find().sort({ timestamp: -1 });
        const results = rawResults.map(doc => ({
            timestamp: doc.timestamp.toLocaleString('pl-PL'),
            nickname: doc.nickname,
            susScore: doc.susScore,
            responses: doc.responses
        }));
        res.render('results', { results: results, questions: SUS_QUESTIONS });
    } catch (e) {
        res.status(500).send("Błąd bazy danych.");
    }
});

app.get('/export', async (req, res) => {
     // (Tutaj wklej kod CSV z poprzedniej wersji - bez zmian, tylko usuń readAllResultsFromMongo i użyj SusResult.find)
     // Dla skrótu tutaj:
     try {
        const results = await SusResult.find().sort({ timestamp: -1 });

        // Nagłówek: Pseudonim;Wynik;P1;...;P10
        const headers = ['Pseudonim', 'Wynik'];
        for (let i = 1; i <= 10; i++) headers.push(`P${i}`);
        let csvContent = headers.join(';') + '\n';

        results.forEach(r => {
            const resp = Array.isArray(r.responses) ? r.responses : [];
            const cols = [r.nickname, r.susScore];
            for (let i = 0; i < 10; i++) cols.push(resp[i] !== undefined ? resp[i] : '');
            csvContent += cols.join(';') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="wyniki.csv"');
        res.send(csvContent);
     } catch(e) { res.status(500).send("Błąd"); }
});

app.get('/export-excel', async (req, res) => {
    try {
        const rawResults = await SusResult.find().sort({ timestamp: -1 });
        if (rawResults.length === 0) return res.status(404).send("Brak wyników.");

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Wyniki SUS');
        
        const columns = [
            { header: 'Pseudonim', key: 'nickname', width: 20 },
            { header: 'Data', key: 'timestamp', width: 25 },
            { header: 'Wynik SUS', key: 'susScore', width: 15 },
        ];
        for (let i = 1; i <= 10; i++) {
            columns.push({ header: `P${i}`, key: `p${i}`, width: 8 });
        }
        worksheet.columns = columns;

        rawResults.forEach(result => {
            const row = {
                nickname: result.nickname,
                timestamp: result.timestamp.toLocaleString('pl-PL'),
                susScore: result.susScore
            };
            const resp = Array.isArray(result.responses) ? result.responses : [];
            for (let i = 1; i <= 10; i++) {
                row[`q${i}`] = resp[i - 1] !== undefined ? resp[i - 1] : '';
            }
            worksheet.addRow(row);
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="sus_wyniki.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (e) {
        console.error(e);
        res.status(500).send("Błąd Excel");
    }
});

app.use(statistic);
// ----------------------------------------------------------------
// START SERWERA (ZMIANA DLA VERCEL)
// ----------------------------------------------------------------

// Vercel wymaga eksportu aplikacji, nie app.listen()
module.exports = app;

// Uruchom nasłuchiwanie TYLKO jeśli to nie jest Vercel (czyli lokalnie)
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Serwer działa lokalnie: http://localhost:${port}`);
    });
}