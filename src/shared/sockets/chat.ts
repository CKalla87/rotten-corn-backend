import { ISenderReceiver, ITyping } from '@chat/interfaces/chat.interface';
import { Server, Socket } from 'socket.io';
import { connectedUsersMap } from './user';
import { config } from '@root/config';
import Logger from 'bunyan';

const log: Logger = config.createLogger('socketIOChat');

export let socketIOChatObject: Server;

export class SocketIOChatHandler {
  private io: Server;

  constructor(io: Server) {
    this.io = io;
    socketIOChatObject = io;
  }

  public listen(): void {
    this.io.on('connection', (socket: Socket) => {
      // Join room based on conversation ID or user IDs
      socket.on('join room', (users: ISenderReceiver) => {
        const { senderId, receiverId, senderName, receiverName } = users;

        // Create room based on conversation (sorted user IDs to ensure same room for both users)
        const roomId = this.getRoomId(senderId, receiverId);
        socket.join(roomId);

        // Also join conversation room by ID if conversationId is provided
        // This allows emitting to a specific conversation
        if ((users as any).conversationId) {
          const conversationRoomId = `conversation:${(users as any).conversationId}`;
          socket.join(conversationRoomId);
          log.info(`User ${senderName} (${senderId}) joined conversation room ${conversationRoomId}`);
        }

        log.info(`User ${senderName} (${senderId}) joined room ${roomId} for conversation with ${receiverName} (${receiverId})`);
      });

      // Handle typing indicators
      socket.on('typing', (data: ITyping) => {
        const { sender, receiver } = data;
        const receiverSocketId = connectedUsersMap.get(receiver);

        if (receiverSocketId) {
          // Emit typing indicator to the receiver's socket
          this.io.to(receiverSocketId).emit('typing', { sender, isTyping: true });
          log.debug(`Typing indicator sent: ${sender} is typing to ${receiver}`);
        }
      });

      socket.on('stop typing', (data: ITyping) => {
        const { sender, receiver } = data;
        const receiverSocketId = connectedUsersMap.get(receiver);

        if (receiverSocketId) {
          // Emit stop typing indicator to the receiver's socket
          this.io.to(receiverSocketId).emit('stop typing', { sender, isTyping: false });
          log.debug(`Stop typing indicator sent: ${sender} stopped typing to ${receiver}`);
        }
      });

      socket.on('disconnect', () => {
        log.info(`Socket ${socket.id} disconnected`);
      });
    });
  }

  /**
   * Get a consistent room ID for a conversation between two users
   * Sorts user IDs to ensure both users join the same room
   */
  private getRoomId(userId1: string, userId2: string): string {
    const sortedIds = [userId1, userId2].sort();
    return `chat:${sortedIds[0]}:${sortedIds[1]}`;
  }

  /**
   * Emit message to specific room (conversation)
   */
  public static emitMessageToRoom(conversationId: string, event: string, data: unknown): void {
    if (socketIOChatObject) {
      socketIOChatObject.to(`conversation:${conversationId}`).emit(event, data);
    }
  }

  /**
   * Emit message to specific user by their socket ID
   */
  public static emitMessageToUser(userId: string, event: string, data: unknown): void {
    if (socketIOChatObject && connectedUsersMap.has(userId)) {
      const socketId = connectedUsersMap.get(userId);
      if (socketId) {
        socketIOChatObject.to(socketId).emit(event, data);
      }
    }
  }

  /**
   * Emit message to both users in a conversation
   */
  public static emitMessageToConversation(senderId: string, receiverId: string, event: string, data: unknown): void {
    if (socketIOChatObject) {
      // Emit to receiver's socket
      const receiverSocketId = connectedUsersMap.get(receiverId);
      if (receiverSocketId) {
        socketIOChatObject.to(receiverSocketId).emit(event, data);
      }

      // Also emit to sender's socket (for UI updates)
      const senderSocketId = connectedUsersMap.get(senderId);
      if (senderSocketId) {
        socketIOChatObject.to(senderSocketId).emit(event, data);
      }
    }
  }
}
