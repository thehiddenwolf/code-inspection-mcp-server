// This file is in the domain layer (by path convention)
// Domain layer depends on [] — no external imports
// All these imports are self-contained or from standard lib

import { EventEmitter } from 'events';
import { randomUUID } from 'node:crypto';

export interface Entity {
  id: string;
  createdAt: Date;
}

export class DomainEntity implements Entity {
  id: string;
  createdAt: Date;

  constructor() {
    this.id = randomUUID();
    this.createdAt = new Date();
  }
}

export function createEntity(): Entity {
  return new DomainEntity();
}
