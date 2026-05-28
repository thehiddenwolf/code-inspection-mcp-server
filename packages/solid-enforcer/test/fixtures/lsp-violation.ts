/**
 * LSP Violation Fixture — derived class that throws NotImplementedError.
 */
export abstract class Repository<T> {
  abstract findAll(): Promise<T[]>;
  abstract findById(id: string): Promise<T | null>;
  abstract save(entity: T): Promise<T>;
  abstract delete(id: string): Promise<void>;
}

export class InMemoryUserRepository extends Repository<any> {
  private users: Map<string, any> = new Map();

  async findAll(): Promise<any[]> {
    return Array.from(this.users.values());
  }

  async findById(id: string): Promise<any | null> {
    return this.users.get(id) || null;
  }

  async save(entity: any): Promise<any> {
    this.users.set(entity.id, entity);
    return entity;
  }

  async delete(id: string): Promise<void> {
    this.users.delete(id);
  }
}

export class FileSystemUserRepository extends Repository<any> {
  private basePath: string;

  constructor(basePath: string) {
    super();
    this.basePath = basePath;
  }

  async findAll(): Promise<any[]> {
    throw new NotImplementedError('findAll is not implemented for file system repository');
  }

  async findById(id: string): Promise<any | null> {
    throw new Error('not implemented');
  }

  async save(entity: any): Promise<any> {
    throw new NotImplementedError('save is not implemented for file system repository');
  }

  async delete(id: string): Promise<void> {
    throw new NotImplementedError('delete is not implemented for file system repository');
  }
}

class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

/**
 * Another LSP violation — empty stub method.
 */
export abstract class Service {
  abstract execute(): Promise<string>;
}

export class MockService extends Service {
  async execute(): Promise<string> {
    // TODO: implement later
    return '';
  }
}
