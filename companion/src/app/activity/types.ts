import type { ISODateTime } from '../../domain/types';

// One category per kind of thing the app DOES (not per screen, not per UI
// element). No 'alarm' category — there is no alarm system in this app.
// Nothing render/nav-shaped belongs here: see activityLog.ts's header
// comment for the rule this union exists to enforce.
export type ActivityCategory = 'lifecycle' | 'sync' | 'dose' | 'motor' | 'meal' | 'regimen' | 'report';

export interface ActivityRow {
  id: string;
  at: ISODateTime;
  category: ActivityCategory;
  message: string;
}
