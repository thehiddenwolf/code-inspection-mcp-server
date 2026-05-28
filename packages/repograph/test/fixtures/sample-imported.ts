/**
 * Sample module imported by sample.ts
 * Contains various exports for testing the RepoGraph file indexer.
 */

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user' | 'moderator';
}

export type UserRole = 'admin' | 'user' | 'moderator';

export class UserService {
  private users: Map<string, UserProfile> = new Map();

  constructor(private baseUrl: string) {}

  async fetchUser(id: string): Promise<UserProfile | null> {
    const user = this.users.get(id);
    return user ?? null;
  }

  createUser(profile: UserProfile): void {
    this.users.set(profile.id, profile);
  }

  deleteUser(id: string): boolean {
    return this.users.delete(id);
  }
}

export const DEFAULT_ROLE: UserRole = 'user';

export function createDefaultUser(name: string): UserProfile {
  return {
    id: crypto.randomUUID(),
    name,
    email: `${name.toLowerCase()}@example.com`,
    role: DEFAULT_ROLE,
  };
}
