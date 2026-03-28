import { Router } from "express";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";
import type { ExportRequest } from "../types.js";
import {
  getForecastRunForUser,
  getLatestForecastRunForUser,
  getScenarioRunForUser,
  getUserState,
  setUserState,
} from "../services/appRepo.js";

const router = Router();

// POST /export – returns a valid PDF or XLSX file.
router.post("/", async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body as ExportRequest;
  const type = body?.type === "xlsx" ? "xlsx" : "pdf";

  try {
    const state = await getUserState(userId);
    const latest = await getLatestForecastRunForUser(userId);
    const preferredRunId =
      body?.runId && body.runId !== "latest"
        ? body.runId
        : state.latestForecastRunId || latest?.id || undefined;
    const forecast =
      preferredRunId
        ? await getForecastRunForUser(userId, preferredRunId)
        : latest?.payload || null;
    if (!forecast) {
      return res.status(404).json({ error: "Forecast run not found. Run forecast first." });
    }
    const scenarioRunId = body?.scenarioRunId || state.latestScenarioRunId || undefined;
    const scenario = scenarioRunId ? await getScenarioRunForUser(userId, scenarioRunId) : null;
    if (preferredRunId) await setUserState(userId, { latestForecastRunId: preferredRunId });
    if (scenarioRunId) await setUserState(userId, { latestScenarioRunId: scenarioRunId });

    if (type === "pdf") {
      const doc = await PDFDocument.create();
      const page = doc.addPage([612, 792]);
      const font = await doc.embedFont(StandardFonts.Helvetica);

      page.drawText("Forecast Report", {
        x: 50,
        y: 720,
        size: 20,
        font,
        color: rgb(0, 0, 0),
      });
      page.drawText("Generated from saved forecast/scenario runs.", {
        x: 50,
        y: 680,
        size: 12,
        font,
        color: rgb(0.4, 0.4, 0.4),
      });
      page.drawText(`Run ID: ${preferredRunId ?? "—"}  |  Scenario: ${scenarioRunId ?? "—"}`, {
        x: 50,
        y: 640,
        size: 10,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
      const mean =
        forecast.forecast.length > 0
          ? forecast.forecast.reduce((a, b) => a + b, 0) / forecast.forecast.length
          : 0;
      page.drawText(
        `Horizon: ${forecast.forecast.length}  Mean forecast: ${mean.toFixed(2)}  MAE: ${forecast.metrics.mae}`,
        {
          x: 50,
          y: 610,
          size: 10,
          font,
          color: rgb(0.2, 0.2, 0.2),
        }
      );
      if (scenario) {
        page.drawText(
          `Scenario summary: ${scenario.scenario.summary?.toFixed(2) ?? "n/a"} (base: ${scenario.base.summary?.toFixed(2) ?? "n/a"})`,
          {
            x: 50,
            y: 590,
            size: 10,
            font,
            color: rgb(0.2, 0.2, 0.2),
          }
        );
      }

      const pdfBytes = await doc.save();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="forecast-report.pdf"');
      res.send(Buffer.from(pdfBytes));
      return;
    }

    // XLSX: export real forecast/scenario rows
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Forecast");
    sheet.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "Actual", key: "actual", width: 10 },
      { header: "Forecast", key: "forecast", width: 10 },
    ];
    sheet.addRows(
      forecast.dates.map((date, i) => ({
        date,
        actual: forecast.actual[i] ?? "",
        forecast: forecast.forecast[i] ?? "",
      }))
    );
    if (scenario) {
      const scenarioSheet = workbook.addWorksheet("Scenario");
      scenarioSheet.columns = [
        { header: "Step", key: "step", width: 10 },
        { header: "Base", key: "base", width: 14 },
        { header: "Scenario", key: "scenario", width: 14 },
      ];
      scenarioSheet.addRows(
        scenario.base.forecast.map((v, i) => ({
          step: i,
          base: v,
          scenario: scenario.scenario.forecast[i] ?? "",
        }))
      );
    }

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="forecast-export.xlsx"');
    res.send(Buffer.from(buffer as ArrayBuffer));
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: "Export failed" });
  }
});

export default router;
