// Registry mapping a CrossSection.diagramKey to its React component. Atlas
// looks a diagram up here by key; a section whose diagram isn't registered
// yet simply can't be opened (handled upstream).

import type { ComponentType } from 'react';
import type { DiagramProps } from './types';
import { CordCervical } from './CordCervical';

export const DIAGRAMS: Record<string, ComponentType<DiagramProps>> = {
  'cord-cervical': CordCervical,
};

export type { DiagramProps, DiagramState } from './types';
