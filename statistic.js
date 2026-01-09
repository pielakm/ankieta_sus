const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

router.get('/statistic', async (req, res) => {
  try {
    const SusResult = mongoose.models.SusResult;
    if (!SusResult) {
      return res.status(500).send('Model danych nie jest zainicjalizowany.');
    }

    const docs = await SusResult.find().sort({ timestamp: 1 }); // sortuj rosnąco dla trendu
    const numQuestions = 10;

    const labels = Array.from({ length: numQuestions }, (_, i) => `P${i + 1}`);
    const distributions = [];
    const averages = [];
    const stdDevs = [];
    const frequencies = []; // częstotliwości odpowiedzi 1-5 dla każdego pytania
    const mostFrequent = []; // najczęściej wybierana odpowiedź

    for (let i = 0; i < numQuestions; i++) {
      const values = docs
        .map((d) => (Array.isArray(d.responses) ? d.responses[i] : undefined))
        .filter((v) => typeof v === 'number' && !Number.isNaN(v));

      distributions.push(values);

      const n = values.length;
      if (n === 0) {
        averages.push(null);
        stdDevs.push(null);
        frequencies.push([0, 0, 0, 0, 0]);
        mostFrequent.push({ value: null, count: 0, percent: 0 });
        continue;
      }

      // Średnia i odchylenie
      const mean = values.reduce((a, b) => a + b, 0) / n;
      const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
      const std = Math.sqrt(variance);

      averages.push(Number(mean.toFixed(2)));
      stdDevs.push(Number(std.toFixed(2)));

      // Częstotliwości odpowiedzi (1-5)
      const freq = [0, 0, 0, 0, 0];
      values.forEach((v) => {
        if (v >= 1 && v <= 5) freq[v - 1]++;
      });
      frequencies.push(freq);

      // Najczęściej wybierana odpowiedź
      const maxCount = Math.max(...freq);
      const maxIndex = freq.indexOf(maxCount);
      mostFrequent.push({
        value: maxIndex + 1,
        count: maxCount,
        percent: ((maxCount / n) * 100).toFixed(1),
      });
    }

    // Dane do heatmapy (macierz pytanie × odpowiedź)
    const heatmapZ = frequencies.map((f) => f.map((count) => count));

    // Trend wyniku SUS w czasie
    const susScores = docs.map((d) => d.susScore);
    const timestamps = docs.map((d) => d.timestamp.toLocaleDateString('pl-PL'));

    res.render('statistic', {
      labels,
      averages,
      stdDevs,
      distributions,
      frequencies,
      mostFrequent,
      heatmapZ,
      susScores,
      timestamps,
    });
  } catch (e) {
    console.error(e);
    res.status(500).send('Błąd bazy danych.');
  }
});

module.exports = router;