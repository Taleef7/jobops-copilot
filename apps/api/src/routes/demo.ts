import { Router } from 'express';
import { clearUserData, seedDemoData } from '@/data/job-store';
import { clearUserReports, seedDemoReports } from '@/data/report-store';
import { deleteUserProfile } from '@/data/profile-store';
import { clearUserSavedSearches } from '@/data/saved-search-store';
import { requireUser } from '@/lib/auth';

export const demoRouter = Router();

// Load the sample CRM into the signed-in account (instant demo).
demoRouter.post('/seed', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;
    await seedDemoData(userId);
    await seedDemoReports(userId);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Wipe everything the signed-in account owns.
demoRouter.post('/clear', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;
    await clearUserData(userId);
    await clearUserReports(userId);
    await deleteUserProfile(userId);
    await clearUserSavedSearches(userId);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
