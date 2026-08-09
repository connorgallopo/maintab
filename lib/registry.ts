import type { ModuleDef } from './types';
import { prsModule } from '../cards/prs';
import { notificationsModule } from '../cards/notifications';
import { vulnsModule } from '../cards/vulns';
import { starsModule } from '../cards/stars';

export const MODULES: ModuleDef[] = [
  prsModule as ModuleDef,
  notificationsModule as ModuleDef,
  vulnsModule as ModuleDef,
  starsModule as ModuleDef,
];
