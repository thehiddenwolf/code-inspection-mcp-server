// This file is in a presentation layer (by path convention)
// Violation: importing from infrastructure layer
import { DatabaseService } from '../infra/database';
import { UserRepository } from '../infra/repositories';

// Allowed: domain imports are fine
import { User } from '../domain/models';
import { DomainService } from '../domain/services';

export class UserController {
  constructor(
    private db: DatabaseService,
    private users: UserRepository,
    private domain: DomainService,
  ) {}

  async getUser(id: string): Promise<User | null> {
    return this.users.findById(id);
  }
}
