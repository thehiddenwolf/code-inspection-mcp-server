/**
 * OCP Violation Fixture — large switch statement on a type discriminator.
 */
export class PaymentProcessor {
  processPayment(type: string, amount: number): string {
    let fee = 0;
    let result: string;

    switch (type) {
      case 'credit_card':
        fee = amount * 0.03;
        result = `Processing credit card payment of $${amount} with fee $${fee}`;
        break;
      case 'debit_card':
        fee = amount * 0.02;
        result = `Processing debit card payment of $${amount} with fee $${fee}`;
        break;
      case 'paypal':
        fee = amount * 0.04;
        result = `Processing PayPal payment of $${amount} with fee $${fee}`;
        break;
      case 'bank_transfer':
        fee = amount * 0.01;
        result = `Processing bank transfer of $${amount} with fee $${fee}`;
        break;
      case 'crypto':
        fee = amount * 0.005;
        result = `Processing crypto payment of $${amount} with fee $${fee}`;
        break;
      case 'apple_pay':
        fee = amount * 0.025;
        result = `Processing Apple Pay payment of $${amount} with fee $${fee}`;
        break;
      default:
        result = `Unknown payment type: ${type}`;
    }

    return result;
  }
}

/**
 * Another OCP violation — if-else chain on string values.
 */
export class NotificationSender {
  send(notificationType: string, recipient: string, message: string): string {
    if (notificationType === 'email') {
      return `Sending email to ${recipient}: ${message}`;
    } else if (notificationType === 'sms') {
      return `Sending SMS to ${recipient}: ${message}`;
    } else if (notificationType === 'push') {
      return `Sending push notification to ${recipient}: ${message}`;
    } else if (notificationType === 'slack') {
      return `Sending Slack message to ${recipient}: ${message}`;
    } else if (notificationType === 'teams') {
      return `Sending Teams message to ${recipient}: ${message}`;
    } else {
      return `Unknown notification type: ${notificationType}`;
    }
  }
}
