/**
 * Clean Code Fixture — no SOLID violations.
 */

// Small, focused interfaces (ISP compliant)
export interface IRepository<T> {
  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<T>;
}

export interface INotificationService {
  send(recipient: string, message: string): Promise<void>;
}

export interface ILogger {
  info(message: string): void;
  error(message: string, error?: Error): void;
}

export interface IMetricsCollector {
  increment(metric: string): void;
  timing(metric: string, durationMs: number): void;
}

// Proper DIP: dependencies injected via constructor
export class UserService {
  constructor(
    private repo: IRepository<any>,
    private notifier: INotificationService,
    private logger: ILogger,
    private metrics: IMetricsCollector,
  ) {}

  async createUser(data: any): Promise<any> {
    const user = { ...data, createdAt: new Date() };
    const saved = await this.repo.save(user);
    this.logger.info(`User created: ${saved.id}`);
    this.metrics.increment('user.created');
    await this.notifier.send(data.email, 'Welcome!');
    return saved;
  }
}

// Small interface (ISP compliant)
export interface ITrackPlayer {
  play(): void;
  pause(): void;
  stop(): void;
}

export class SimpleAudioPlayer implements ITrackPlayer {
  play(): void {
    /* playing */
  }
  pause(): void {
    /* paused */
  }
  stop(): void {
    /* stopped */
  }
}

// Strategy pattern instead of large switches (OCP compliant)
export interface PaymentStrategy {
  process(amount: number): string;
}

export class CreditCardStrategy implements PaymentStrategy {
  process(amount: number): string {
    return `Credit card: $${amount}`;
  }
}

export class PayPalStrategy implements PaymentStrategy {
  process(amount: number): string {
    return `PayPal: $${amount}`;
  }
}

export class PaymentContext {
  constructor(private strategy: PaymentStrategy) {}

  execute(amount: number): string {
    return this.strategy.process(amount);
  }
}

// Proper LSP: no NotImplementedError, no empty stubs
export abstract class BaseParser {
  abstract parse(input: string): Record<string, unknown>;
}

export class JsonParser extends BaseParser {
  parse(input: string): Record<string, unknown> {
    return JSON.parse(input);
  }
}
