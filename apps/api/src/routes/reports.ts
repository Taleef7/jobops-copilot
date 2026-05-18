import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { getLatestWeeklyReport, listWeeklyReports } from '@/data/report-store';
import {
  buildLocalWeeklyReportExportPath,
  buildWeeklyReportExportFileName,
} from '@/lib/report-export';

export const reportsRouter = Router();

reportsRouter.get('/', async (_request, response, next) => {
  try {
    const reports = await listWeeklyReports();
    response.json({ reports });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/latest', async (_request, response, next) => {
  try {
    const report = await getLatestWeeklyReport();

    if (!report) {
      response.status(404).json({ error: 'No weekly reports found' });
      return;
    }

    response.json({ report });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/:reportId/export', async (request, response, next) => {
  try {
    const reports = await listWeeklyReports();
    const report = reports.find((entry) => entry.id === request.params.reportId);

    if (!report) {
      response.status(404).json({ error: 'Weekly report not found' });
      return;
    }

    const exportPath = buildLocalWeeklyReportExportPath(report);
    let markdown = report.reportMarkdown.endsWith('\n')
      ? report.reportMarkdown
      : `${report.reportMarkdown}\n`;

    try {
      markdown = await readFile(exportPath, 'utf8');
    } catch {
      // Fall back to the stored markdown if the local file has not been written yet.
    }

    response
      .type('text/markdown; charset=utf-8')
      .set('Content-Disposition', `inline; filename="${buildWeeklyReportExportFileName(report)}"`)
      .send(markdown);
  } catch (error) {
    next(error);
  }
});
