import { BaseCache } from '@service/redis/base.cache';
import Logger from 'bunyan';
import { config } from '@root/config';
import { ServerError } from '@global/helpers/error-handler';
import { Helpers } from '@global/helpers/helpers';
import { find, findIndex, filter, remove } from 'lodash';
import { IChatList, IChatUsers, IGetMessageFromCache, IMessageData } from '@chat/interfaces/chat.interface';
import { IReaction } from '@reaction/interfaces/reaction.interface';

const log: Logger = config.createLogger('messageCache');

export class MessageCache extends BaseCache {
  constructor() {
    super('messageCache');
  }

  public async addChatListToCache(senderId: string, receiverId: string, conversationId: string): Promise<void> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const userChatList: string[] = await this.client.LRANGE(`chatList:${senderId}`, 0, -1);
      if (!userChatList.length) {
        await this.client.RPUSH(`chatList:${senderId}`, JSON.stringify({ receiverId, conversationId }));
        return;
      }

      const receiverIndex: number = userChatList.findIndex((listItem: string) => listItem.includes(receiverId));
      if (receiverIndex < 0) {
        await this.client.RPUSH(`chatList:${senderId}`, JSON.stringify({ receiverId, conversationId }));
      }
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async addChatMessageToCache(conversationId: string, value: IMessageData): Promise<void> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      await this.client.RPUSH(`messages:${conversationId}`, JSON.stringify(value));
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async addChatUsersToCache(value: IChatUsers): Promise<IChatUsers[]> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const users: IChatUsers[] = await this.getChatUsersList();
      const usersIndex: number = findIndex(users, (listItem: IChatUsers) => JSON.stringify(listItem) === JSON.stringify(value));

      let chatUsers: IChatUsers[] = [];
      if (usersIndex === -1) {
        await this.client.RPUSH('chatUsers', JSON.stringify(value));
        chatUsers = await this.getChatUsersList();
      } else {
        chatUsers = users;
      }

      return chatUsers;
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async removeChatUsersFromCache(value: IChatUsers): Promise<IChatUsers[]> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const users: IChatUsers[] = await this.getChatUsersList();
      const usersIndex: number = findIndex(users, (listItem: IChatUsers) => JSON.stringify(listItem) === JSON.stringify(value));

      let chatUsers: IChatUsers[] = [];
      if (usersIndex > -1) {
        await this.client.LREM('chatUsers', usersIndex, JSON.stringify(value));
        chatUsers = await this.getChatUsersList();
      } else {
        chatUsers = users;
      }

      return chatUsers;
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async getUserConversationList(key: string): Promise<IMessageData[]> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const userChatList: string[] = await this.client.LRANGE(`chatList:${key}`, 0, -1);
      const conversationChatList: IMessageData[] = [];
      for (const item of userChatList) {
        const chatItem = Helpers.parseJson(item) as IChatList;
        const lastMessage: string = (await this.client.LINDEX(`messages:${chatItem.conversationId}`, -1)) as string;
        if (lastMessage) {
          conversationChatList.push(Helpers.parseJson(lastMessage) as IMessageData);
        }
      }

      return conversationChatList;
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async getChatMessagesFromCache(senderId: string, receiverId: string): Promise<IMessageData[]> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const userChatList: string[] = await this.client.LRANGE(`chatList:${senderId}`, 0, -1);
      const receiver: string = find(userChatList, (listItem: string) => listItem.includes(receiverId)) as string;
      if (!receiver) {
        return [];
      }
      const parsedReceiver: IChatList = Helpers.parseJson(receiver) as IChatList;
      const userMessages: string[] = await this.client.LRANGE(`messages:${parsedReceiver.conversationId}`, 0, -1);
      const chatMessages: IMessageData[] = [];
      for (const item of userMessages) {
        const chatItem = Helpers.parseJson(item) as IMessageData;
        chatMessages.push(chatItem);
      }
      return chatMessages;
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async markMessageAsDeleted(senderId: string, receiverId: string, messageId: string, type: string): Promise<IMessageData> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const messageResponse: IGetMessageFromCache | null = await this.getMessage(senderId, receiverId, messageId);
      if (!messageResponse) {
        return {} as IMessageData;
      }
      const { index, message, receiver } = messageResponse;
      const chatItem: IMessageData = Helpers.parseJson(message) as IMessageData;
      if (type === 'deleteForMe') {
        chatItem.deleteForMe = true;
      } else {
        chatItem.deleteForMe = true;
        chatItem.deleteForEveryone = true;
      }

      await this.client.LSET(`messages:${receiver.conversationId}`, index, JSON.stringify(chatItem));
      const lastMessage: string = (await this.client.LINDEX(`messages:${receiver.conversationId}`, -1)) as string;
      return lastMessage ? (Helpers.parseJson(lastMessage) as IMessageData) : chatItem;
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async updateChatMessages(senderId: string, receiverId: string): Promise<IMessageData> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const userChatList: string[] = await this.client.LRANGE(`chatList:${senderId}`, 0, -1);
      const receiver: string = find(userChatList, (listItem: string) => listItem.includes(receiverId)) as string;
      if (!receiver) {
        return {} as IMessageData;
      }
      const parsedReceiver: IChatList = Helpers.parseJson(receiver) as IChatList;
      const messages: string[] = await this.client.LRANGE(`messages:${parsedReceiver.conversationId}`, 0, -1);
      const unreadMessages: string[] = filter(messages, (listItem: string) => {
        const chatItem = Helpers.parseJson(listItem) as IMessageData;
        return !chatItem.isRead;
      });

      for (const item of unreadMessages) {
        const chatItem = Helpers.parseJson(item) as IMessageData;
        chatItem.isRead = true;
        const messageIndex: number = findIndex(messages, (listItem: string) => listItem === item);
        await this.client.LSET(`messages:${parsedReceiver.conversationId}`, messageIndex, JSON.stringify(chatItem));
      }

      const lastMessage: string = (await this.client.LINDEX(`messages:${parsedReceiver.conversationId}`, -1)) as string;
      return lastMessage ? (Helpers.parseJson(lastMessage) as IMessageData) : ({} as IMessageData);
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async updateMessageReaction(
    conversationId: string,
    messageId: string,
    reaction: string,
    senderName: string,
    type: string
  ): Promise<IMessageData> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const messages: string[] = await this.client.LRANGE(`messages:${conversationId}`, 0, -1);
      const messageIndex: number = findIndex(messages, (listItem: string) => listItem.includes(messageId));
      if (messageIndex === -1) {
        return {} as IMessageData;
      }
      const message: IMessageData = Helpers.parseJson(messages[messageIndex]) as IMessageData;
      const reactions: IReaction[] = Array.isArray(message.reaction) ? [...message.reaction] : [];

      remove(reactions, (reactionData: IReaction) => reactionData.senderName === senderName);
      if (type === 'add') {
        reactions.push({ senderName, type: reaction });
      }

      message.reaction = reactions;
      await this.client.LSET(`messages:${conversationId}`, messageIndex, JSON.stringify(message));
      const updatedMessage: string = (await this.client.LINDEX(`messages:${conversationId}`, messageIndex)) as string;
      return updatedMessage ? (Helpers.parseJson(updatedMessage) as IMessageData) : message;
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  private async getChatUsersList(): Promise<IChatUsers[]> {
    const chatUsersList: IChatUsers[] = [];
    const chatUsers: string[] = await this.client.LRANGE('chatUsers', 0, -1);
    for (const item of chatUsers) {
      const chatUser = Helpers.parseJson(item) as IChatUsers;
      chatUsersList.push(chatUser);
    }
    return chatUsersList;
  }

  private async getMessage(senderId: string, receiverId: string, messageId: string): Promise<IGetMessageFromCache | null> {
    const userChatList: string[] = await this.client.LRANGE(`chatList:${senderId}`, 0, -1);
    const receiver: string = find(userChatList, (listItem: string) => listItem.includes(receiverId)) as string;
    if (!receiver) {
      return null;
    }
    const parsedReceiver: IChatList = Helpers.parseJson(receiver) as IChatList;
    const messages: string[] = await this.client.LRANGE(`messages:${parsedReceiver.conversationId}`, 0, -1);
    const messageIndex: number = findIndex(messages, (listItem: string) => listItem.includes(messageId));
    if (messageIndex === -1) {
      return null;
    }
    const message: string = messages[messageIndex];
    return { index: messageIndex, message, receiver: parsedReceiver };
  }
}
