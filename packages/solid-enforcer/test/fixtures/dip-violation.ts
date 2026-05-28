/**
 * DIP Violation Fixture — class that instantiates concrete dependencies directly.
 */

// Concrete implementations (no abstractions)
export class MySqlDatabase {
  query(sql: string): any[] {
    console.log(`Executing: ${sql}`);
    return [];
  }

  save(table: string, data: any): void {
    console.log(`Saving to ${table}`);
  }
}

export class EmailService {
  send(to: string, subject: string, body: string): void {
    console.log(`Emailing ${to}: ${subject}`);
  }
}

export class Logger {
  log(level: string, message: string): void {
    console.log(`[${level}] ${message}`);
  }
}

export class MetricsCollector {
  record(name: string, value: number): void {
    console.log(`Metric: ${name} = ${value}`);
  }

  static getInstance(): MetricsCollector {
    return new MetricsCollector();
  }
}

export class Config {
  get(key: string): string {
    return 'some-value';
  }
}

/**
 * Violation: Direct instantiation of concrete classes instead of constructor injection.
 */
export class OrderService {
  private db: MySqlDatabase;
  private emailer: EmailService;
  private logger: Logger;
  private metrics: MetricsCollector;

  constructor() {
    this.db = new MySqlDatabase();
    this.emailer = new EmailService();
    this.logger = new Logger();
    this.metrics = MetricsCollector.getInstance();
  }

  placeOrder(order: any): void {
    this.logger.log('info', 'Placing order...');
    this.metrics.record('order.created', 1);
    this.db.save('orders', order);
    this.emailer.send(order.email, 'Order Confirmed', 'Your order has been placed.');
  }
}

/**
 * Clean version (should NOT trigger DIP violations).
 * Proper constructor injection with interface-like params.
 */
export interface IRepository {
  save(table: string, data: any): void;
}

export interface INotifier {
  send(to: string, subject: string, body: string): void;
}

export class CleanOrderService {
  constructor(
    private repo: IRepository,
    private notifier: INotifier,
  ) {}

  placeOrder(order: any): void {
    this.repo.save('orders', order);
    this.notifier.send(order.email, 'Order Confirmed', 'Your order has been placed.');
  }
}
