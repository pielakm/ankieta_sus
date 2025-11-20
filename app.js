const express = require('express');
const app = express();
const port = 3000;
const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Zmieniona lokalizacja pliku:
const RESULTS_FILE = path.join(__dirname, 'sus_results.csv');

// Konfiguracja Express.js
app.set('view engine', 'ejs');
app.set('views', 'views');
app.use(express.urlencoded({ extended: true }));

// Standardowe pytania SUS (bez zmian)
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

// ... (Funkcja calculateSusScore pozostaje bez zmian) ...
function calculateSusScore(responses) {
    let totalPoints = 0;
    let completedQuestions = 0;

    SUS_QUESTIONS.forEach((question, index) => {
        const N = parseInt(responses[`q${index}`], 10);
        
        if (N >= 1 && N <= 5) {
            completedQuestions++;
            let points;
            
            if (question.isPositive) {
                points = N - 1; 
            } else {
                points = 5 - N; 
            }
            totalPoints += points;
        }
    });

    if (completedQuestions !== SUS_QUESTIONS.length) {
        return null;
    }

    const susScore = totalPoints * 2.5;
    return Math.round(susScore * 10) / 10;
}
// ---------------------------------------------------------------- //

/**
 * Zapisuje nową odpowiedź do pliku CSV, używając pseudonimu zamiast ID.
 * @param {object} rawResponses - Surowe odpowiedzi użytkownika.
 * @param {number} susScore - Obliczony wynik SUS.
 * @param {string} nickname - Pseudonim użytkownika.
 */
async function saveToCSV(rawResponses, susScore, nickname) {
    // Sprawdzamy, czy plik istnieje, używając fs/promises
    const isFileExist = await fs.access(RESULTS_FILE).then(() => true).catch(() => false);
    
    // Tworzenie nagłówków (ID zamienione na PSEUDONIM)
    let header = ['Pseudonim', 'Data i Czas'];
    for (let i = 0; i < SUS_QUESTIONS.length; i++) {
        header.push(`P${i + 1}`);
    }
    header.push('WYNIK_SUS');
    
    // Tworzenie wiersza danych
    let row = [
        `"${nickname.trim()}"`, // Dodajemy pseudonim
        `"${new Date().toLocaleString('pl-PL')}"`
    ];
    for (let i = 0; i < SUS_QUESTIONS.length; i++) {
        row.push(rawResponses[`q${i}`]);
    }
    row.push(susScore);

    let content = '';

    // Jeśli plik nie istnieje, dodajemy nagłówki
    if (!isFileExist) {
        content += header.join(';') + '\n';
    }

    // Dodajemy nowy wiersz
    content += row.join(';') + '\n';

    // Dopisywanie do pliku. Używamy { flag: 'a' } (append)
    await fs.writeFile(RESULTS_FILE, content, { flag: 'a' });
}

/**
 * Odczytuje wszystkie wyniki z pliku CSV.
 */
async function readAllResults() {
    try {
        const data = await fs.readFile(RESULTS_FILE, 'utf8');
        const lines = data.trim().split('\n');

        if (lines.length <= 1) { // Tylko nagłówek lub pusty plik
            return [];
        }

        const results = [];
        const dataRows = lines.slice(1); 
        
        dataRows.forEach(line => {
            const values = line.split(';');

            if (values.length < 12) return; 

            const rowData = {};
            // Zmienione indeksy odczytu, aby pasowały do nowego nagłówka CSV
            rowData.nickname = values[0].replace(/"/g, ''); 
            rowData.timestamp = values[1].replace(/"/g, ''); 
            rowData.susScore = parseFloat(values[values.length - 1]);
            
            rowData.responses = [];
            // Odczyt odpowiedzi P1 do P10 (indeksy 2 do 11)
            for (let i = 0; i < SUS_QUESTIONS.length; i++) {
                rowData.responses.push(parseInt(values[i + 2], 10)); 
            }

            results.push(rowData);
        });

        return results;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

// NOWA FUNKCJA INTERPRETACYJNA
function interpretSusScore(score) {
    if (score >= 80.3) {
        return { rating: "Znakomity (Excellent)", grade: "A" };
    } else if (score >= 70.0) {
        return { rating: "Dobry (Good)", grade: "B" };
    } else if (score >= 68.0) {
        return { rating: "Neutralny/OK", grade: "C" };
    } else if (score >= 50.0) {
        return { rating: "Przeciętny (Below Average)", grade: "D" };
    } else {
        return { rating: "Słaby/Nieakceptowalny (Poor)", grade: "F" };
    }
}


// ---------------------------------------------------------------- //

// app.js, trasa GET '/'
app.get('/', (req, res) => {
    const nickname = req.query.nickname || null;
    
    res.render('index', { 
        questions: SUS_QUESTIONS, 
        susScore: null,
        error: null,
        nickname: nickname,
        susInterpretation: null // Dodajemy null, aby szablon się nie złamał
    });
});

// Trasa POST: Przetwarza odpowiedzi, oblicza wynik i zapisuje go
app.post('/', async (req, res) => {
    const susScore = calculateSusScore(req.body);
    const nickname = req.body.nickname; 

    if (!nickname || nickname.trim() === '') {
        return res.render('index', {
            questions: SUS_QUESTIONS,
            susScore: null,
            error: "Pseudonim jest wymagany, aby rozpocząć ankietę.",
            nickname: null
        });
    }

    if (susScore === null) {
        return res.render('index', {
            questions: SUS_QUESTIONS,
            susScore: null,
            error: "Proszę odpowiedzieć na wszystkie 10 pytań.",
            nickname: nickname,
            susInterpretation: null // Dodanie tutaj dla pełnej spójności
        });
    }

    // INTERPRETACJA WYNIKU
    const interpretation = interpretSusScore(susScore);

    // Zapisz do CSV z pseudonimem
    try {
        // Ważne: Zapisujemy tylko wynik liczbowy, interpretację przekazujemy tylko do widoku
        await saveToCSV(req.body, susScore, nickname);
    } catch (e) {
        console.error("Błąd zapisu do CSV:", e);
    }

    res.render('index', { 
        questions: SUS_QUESTIONS, 
        susScore: susScore,
        // PRZEKAZUJEMY INTERPRETACJĘ DO SZABLONU
        susInterpretation: interpretation, 
        error: null,
        nickname: nickname
    });
});

// Trasa POST dla samego wpisania pseudonimu (przekierowanie na tę samą trasę GET)
app.post('/start', (req, res) => {
    const nickname = req.body.nickname;
    if (!nickname || nickname.trim() === '') {
         // Jeśli pseudonim jest pusty, wracamy do widoku z błędem
         return res.render('index', { 
            questions: SUS_QUESTIONS, 
            susScore: null,
            error: "Pseudonim jest wymagany, aby rozpocząć ankietę.",
            nickname: null
        });
    }
    // Przekierowanie do trasy głównej z pseudonimem w URL
    res.redirect(`/?nickname=${encodeURIComponent(nickname)}`);
});


// Nowa trasa GET: Wyświetla wszystkie wyniki w tabeli (pozostaje bez zmian)
app.get('/results', async (req, res) => {
    try {
        const results = await readAllResults();
        res.render('results', { results: results, questions: SUS_QUESTIONS });
    } catch (e) {
        console.error("Błąd odczytu z CSV:", e);
        res.status(500).send("Wystąpił błąd podczas ładowania wyników.");
    }
});

app.listen(port, () => {
    console.log(`Serwer SUS działa pod adresem http://localhost:${port}`);
});