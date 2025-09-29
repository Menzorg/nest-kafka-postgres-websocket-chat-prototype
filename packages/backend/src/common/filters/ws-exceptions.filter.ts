import {
  Catch,
  ArgumentsHost,
  HttpException,
  Logger
} from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';

@Catch()
export class WsExceptionsFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WsExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient();

    let error: any;

    if (exception instanceof WsException) {
      error = exception.getError();
    } else if (exception instanceof HttpException) {
      error = {
        status: exception.getStatus(),
        message: exception.getResponse()
      };
    } else if (exception instanceof Error) {
      error = {
        message: exception.message,
        name: exception.name
      };
    } else {
      error = {
        message: 'Unknown error occurred'
      };
    }

    // Log the error
    this.logger.error(
      'WebSocket error:',
      exception instanceof Error ? exception.stack : exception,
      'WsExceptionFilter'
    );

    // Send error to client
    client.emit('exception', {
      error,
      timestamp: new Date().toISOString()
    });
  }
}