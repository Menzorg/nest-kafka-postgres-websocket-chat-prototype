# NestJS + Kafka + PostgreSQL + WebSocket Chat Prototype

A real-time chat application built with NestJS, Kafka, PostgreSQL, and WebSockets (Socket.io).

## Getting Started

```bash
docker-compose up -d --build
```

Frontend URL: http://localhost:3000

## Current Features (Implemented Scenarios)

### 1. User Authentication & Registration
- ✅ User signup with email, name, and password
- ✅ User login with email and password
- ✅ JWT token-based authentication
- ✅ Persistent authentication (token stored in localStorage)

### 2. User Presence Management
- ✅ Real-time online/offline status tracking
- ✅ Automatic status updates on connection/disconnection
- ✅ Visual indicators for user availability

### 3. Real-Time Messaging
- ✅ Send text messages in real-time
- ✅ Receive messages instantly via WebSocket
- ✅ Message persistence in PostgreSQL database
- ✅ Auto-scrolling to latest messages

### 4. Message Delivery Status
- ✅ **Sent** (✓) - Message sent to server
- ✅ **Delivered** (✓✓) - Message delivered to recipient's device
- ✅ **Read** (✓✓✓) - Message read by recipient (click on message to mark as read)

### 5. Chat Room Management
- ✅ Create private chat between two users
- ✅ Join/leave chat rooms
- ✅ Automatic room creation on first message
- ✅ Chat history persistence

### 6. WebSocket Integration
- ✅ Real-time bidirectional communication
- ✅ Automatic reconnection on connection loss
- ✅ Connection status indicators
- ✅ Room-based message broadcasting

### 7. Backend Architecture
- ✅ NestJS modular architecture
- ✅ TypeORM with PostgreSQL for data persistence
- ✅ Kafka integration for message processing
- ✅ Socket.io for real-time communication
- ✅ JWT-based WebSocket authentication

## TODO: Missing Chat Scenarios

### High Priority Features

#### 1. Message Pinning
- [x] Pin important messages to chat top
- [x] Unpin messages
- [x] Display pinned messages section
- [x] Sync pinned messages across devices
- [ ] Maximum pinned messages limit (configurable)

#### 2. Message Forwarding
- [x] Forward messages to other chats/users
- [x] Forward multiple messages at once
- [x] Include original sender information
- [x] Forward with additional comment

#### 3. Message Editing & Deletion
- [ ] Edit sent messages within time limit
- [ ] Show "edited" indicator
- [ ] Delete messages for self
- [ ] Delete messages for everyone
- [ ] Message edit history

#### 4. File & Media Sharing
- [ ] Send images (JPEG, PNG, GIF)
- [ ] Send documents (PDF, DOCX, etc.)
- [ ] Send videos with preview
- [ ] Send voice messages
- [ ] File size limitations
- [ ] Image compression & thumbnails
- [ ] Download progress indicators

#### 5. Message Search
- [ ] Search messages by content
- [ ] Search by sender
- [ ] Search by date range
- [ ] Jump to message in chat
- [ ] Highlight search results

### Medium Priority Features

#### 6. Message Reactions/Emojis
- [ ] React to messages with emojis
- [ ] Multiple reactions per message
- [ ] Custom emoji support
- [ ] Reaction notifications
- [ ] Most used emojis section

#### 7. Group Chats
- [ ] Create group chats with multiple users
- [ ] Add/remove participants
- [ ] Group admins and permissions
- [ ] Group info and settings
- [ ] Leave group functionality

#### 8. Typing Indicators
- [ ] Show when user is typing
- [ ] Multiple users typing in group
- [ ] Typing timeout handling
- [ ] Optimize typing event frequency

#### 9. Message Threading/Replies
- [ ] Reply to specific messages
- [ ] Quote messages
- [ ] Thread view for conversations
- [ ] Thread notifications
- [ ] Jump to original message

#### 10. Message Encryption
- [ ] End-to-end encryption
- [ ] Key exchange protocol
- [ ] Encrypted file sharing
- [ ] Backup encryption keys
- [ ] Security indicators

### Low Priority Features

#### 11. Voice & Video Calls
- [ ] One-on-one voice calls
- [ ] One-on-one video calls
- [ ] Group calls
- [ ] Screen sharing
- [ ] Call history
- [ ] WebRTC integration

#### 12. Message Scheduling
- [ ] Schedule messages for later
- [ ] Recurring messages
- [ ] Edit scheduled messages
- [ ] Cancel scheduled messages
- [ ] Timezone handling

#### 13. Chat Customization
- [ ] Custom chat backgrounds
- [ ] Theme selection (dark/light/custom)
- [ ] Font size adjustment
- [ ] Notification sounds
- [ ] Chat color schemes

#### 14. Advanced Notifications
- [ ] Push notifications
- [ ] Email notifications
- [ ] Notification preferences
- [ ] Do not disturb mode
- [ ] Notification grouping

#### 15. Message Translation
- [ ] Auto-detect language
- [ ] Translate messages on demand
- [ ] Preferred language settings
- [ ] Original message preservation

#### 16. Chat Backup & Export
- [ ] Export chat history
- [ ] Backup to cloud
- [ ] Import chat history
- [ ] Multiple export formats (JSON, CSV, PDF)

#### 17. User Blocking & Reporting
- [ ] Block users
- [ ] Report inappropriate content
- [ ] Blocked users list
- [ ] Moderation queue
- [ ] Auto-moderation rules

#### 18. Message Templates & Quick Replies
- [ ] Save message templates
- [ ] Quick reply suggestions
- [ ] Canned responses
- [ ] Template categories
- [ ] Keyboard shortcuts

#### 19. Location Sharing
- [ ] Share current location
- [ ] Share live location
- [ ] Location history
- [ ] Map integration
- [ ] Privacy controls

#### 20. Read Receipts Controls
- [ ] Disable read receipts
- [ ] Disable typing indicators
- [ ] Privacy settings per user
- [ ] Last seen status control

## Architecture

### Frontend
- Next.js 13+ with App Router
- React Hooks for state management
- Socket.io client for WebSocket
- Tailwind CSS for styling

### Backend
- NestJS framework
- PostgreSQL with TypeORM
- Apache Kafka for message queue
- Socket.io for real-time events
- JWT authentication

### Database Schema
- Users table
- Messages table
- Chats table
- Chat participants junction table

## Development

### Prerequisites
- Docker & Docker Compose
- Node.js 18+
- PostgreSQL
- Apache Kafka

### Environment Variables
See `.env.example` files in both `packages/backend` and `packages/frontend` directories.

### Testing
```bash
# Backend tests
cd packages/backend
npm test

# Frontend tests
cd packages/frontend
npm test
```

## Contributing
1. Fork the repository
2. Create a feature branch
3. Implement scenario from TODO list
4. Add tests for new functionality
5. Update this README (mark scenario as completed)
6. Submit pull request

## License
MIT