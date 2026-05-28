/**
 * SRP Violation Fixture — a class that handles DB, UI, business logic, and external services.
 */
export class UserManager {
  private db: any;
  private logger: any;

  constructor(db: any, logger: any) {
    this.db = db;
    this.logger = logger;
  }

  // Database operations
  async getUser(id: string) {
    return this.db.query('SELECT * FROM users WHERE id = ?', [id]);
  }

  async saveUser(user: any) {
    return this.db.insert('users', user);
  }

  async deleteUser(id: string) {
    return this.db.delete('users', { id });
  }

  // Business logic
  calculateUserScore(user: any): number {
    const age = (Date.now() - new Date(user.createdAt).getTime()) / 86400000;
    const activity = user.logins / Math.max(1, age);
    const engagement = user.posts / Math.max(1, age);
    return (activity * 0.4 + engagement * 0.6) * 100;
  }

  validateUserData(data: any): boolean {
    return data.email && data.email.includes('@') && data.name && data.name.length > 0;
  }

  processTransaction(user: any, amount: number) {
    if (amount > user.balance) {
      throw new Error('Insufficient funds');
    }
    user.balance -= amount;
    return this.db.update('users', { balance: user.balance }, { id: user.id });
  }

  // UI formatting
  formatUserHTML(user: any): string {
    return `
      <div class="user-card">
        <h2>${user.name}</h2>
        <p>Email: ${user.email}</p>
        <p>Score: ${this.calculateUserScore(user)}</p>
      </div>
    `;
  }

  displayUserProfile(user: any) {
    document.getElementById('profile')!.innerHTML = this.formatUserHTML(user);
  }

  showNotification(message: string) {
    const el = document.createElement('div');
    el.className = 'notification';
    el.innerText = message;
    document.body.appendChild(el);
  }

  // External service calls
  sendWelcomeEmail(user: any) {
    return fetch('/api/email/send', {
      method: 'POST',
      body: JSON.stringify({
        to: user.email,
        template: 'welcome',
        data: { name: user.name },
      }),
    });
  }

  async notifySlack(channel: string, message: string) {
    return fetch('/api/slack/post', {
      method: 'POST',
      body: JSON.stringify({ channel, text: message }),
    });
  }

  // Logging
  logActivity(userId: string, action: string) {
    this.logger.info(`User ${userId} performed ${action}`);
    console.log(`[AUDIT] User ${userId}: ${action}`);
  }
}
