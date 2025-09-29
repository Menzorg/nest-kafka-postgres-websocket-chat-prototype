import { Injectable, OnApplicationShutdown, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownService.name);
  private shutdownListeners: Array<() => Promise<void>> = [];

  addShutdownListener(listener: () => Promise<void>) {
    this.shutdownListeners.push(listener);
  }

  async onApplicationShutdown(signal?: string) {
    this.logger.log(`Graceful shutdown initiated (signal: ${signal})`);

    // Execute all shutdown listeners
    await Promise.all(
      this.shutdownListeners.map(async (listener) => {
        try {
          await listener();
        } catch (error) {
          this.logger.error('Error during shutdown:', error);
        }
      })
    );

    this.logger.log('Graceful shutdown completed');
  }
}