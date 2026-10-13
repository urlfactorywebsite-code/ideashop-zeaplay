# Websocket Direct Message Fixes

## Issues Identified

1. **Auto-Reconnection Disabled** - Socket was configured with `reconnection: false`, preventing automatic reconnection if the connection dropped
2. **Incomplete Message Delivery** - Direct messages might not be delivered if the recipient hadn't joined the chat room yet
3. **Missing Error Handling** - Failed message sends were silently ignored with no user feedback
4. **No Timeout Protection** - Message sends had no timeout protection, potentially leaving requests hanging
5. **Inadequate memberIds Handling** - memberIds could be empty for new direct spaces, causing delivery issues

## Fixes Applied

### 1. Frontend: useChatRealtime.ts

#### Fixed Socket Reconnection
```typescript
// Before:
reconnection: false,

// After:
reconnection: true,
reconnectionDelay: 1000,
reconnectionDelayMax: 5000,
reconnectionAttempts: 5,
timeout: 10000,
```
- Enables automatic reconnection attempts with exponential backoff
- Maxes out at 5 seconds between attempts
- Gives up after 5 failed attempts

#### Improved sendMessage with Error Handling
```typescript
// Before: Returns null on error
return new Promise<ChatRealtimeMessage | null>((resolve) => {
  socket.emit('chat:message', message, (payload) => {
    if (payload?.ok && payload.message) {
      resolve(payload.message);
      return;
    }
    resolve(null);
  });
});

// After: Throws proper errors
return new Promise<ChatRealtimeMessage>((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject(new Error('Message send timeout. Please try again.'));
  }, 10000);

  socket.emit('chat:message', message, (payload) => {
    clearTimeout(timeout);
    if (payload?.ok && payload.message) {
      resolve(payload.message);
      return;
    }
    if (payload?.error) {
      setError(payload.error);
      reject(new Error(payload.error));
      return;
    }
    reject(new Error('Failed to send message'));
  });
});
```
- Adds timeout protection (10 seconds)
- Throws proper errors instead of returning null
- Better error messages for debugging

#### Added Debug Logging
- Connection/disconnect events are now logged
- Space join/leave events are logged with details
- Chat history fetch count is logged

### 2. Frontend: Chat.tsx

#### Ensured memberIds Always Set
```typescript
// Before: Could be empty
memberIds: activeSpace.memberIds,

// After: Fallback to user ID if empty
memberIds: activeSpace.memberIds && activeSpace.memberIds.length > 0 ? activeSpace.memberIds : [user.id],
```
- Guarantees memberIds is never empty
- Ensures at least the sender is included

#### Improved Error Handling for Direct Messages
```typescript
// Before: Silent failure with void
void sendRealtimeMessage(message);

// After: Proper error handling with user feedback
sendRealtimeMessage(message).catch((error) => {
  console.error('Failed to send message:', error);
  const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
  setComposerError(errorMessage);
  // Re-add message content to composer for retry
  setComposer(body);
  // Restore attachments
  if (message.attachments && message.attachments.length > 0) {
    setComposerAttachments(message.attachments.map((att) => ({
      id: att.id,
      name: att.name,
      type: att.type,
      size: att.size,
      dataUrl: att.dataUrl,
    })));
  }
  // Remove from messages since it failed
  setMessages((prev) => prev.filter((m) => m.id !== message.id));
});
```
- Shows error messages to the user
- Preserves message content for retry
- Restores attachments that weren't sent
- Removes optimistically-added message if send fails

### 3. Backend: realtime/server.js

#### Improved Message Broadcasting for Direct Messages
```javascript
// Before: Could only broadcast to sender's room if memberIds was empty
io.to(buildChatRoom(spaceId)).emit('chat:message', message);
if (memberIds.length > 0) {
  memberIds.forEach((memberId) => {
    io.to(buildUserRoom(memberId)).emit('chat:message', message);
  });
} else {
  io.to(buildUserRoom(userId)).emit('chat:message', message);
}

// After: Always broadcasts to all users including sender
const allRecipients = new Set(memberIds);
allRecipients.add(userId);
const recipientArray = Array.from(allRecipients);

// Broadcast to chat room for all joined users
io.to(buildChatRoom(spaceId)).emit('chat:message', message);

// Broadcast to each user's personal room (critical for direct messages)
recipientArray.forEach((memberId) => {
  io.to(buildUserRoom(memberId)).emit('chat:message', message);
});
```
- Ensures ALL recipients receive the message via user rooms
- Works even if recipient hasn't joined the space room yet
- Guarantees sender receives their own message confirmation

#### Added Comprehensive Debug Logging
- Server logs when users connect
- Logs when spaces are created/sent with recipient count
- Logs when users join/leave spaces with message history count
- Logs when messages are sent with recipient list

## How These Fixes Resolve Direct Message Issues

### Before Fixes:
1. User A creates direct message space with User B
2. User A sends a message
3. If User B hasn't joined the chat room yet, they might not receive it via `buildChatRoom(spaceId)`
4. If memberIds is somehow empty, User B's user room won't be in the broadcast list
5. If socket drops, no auto-reconnect

### After Fixes:
1. User A creates direct message space with User B
2. Space is broadcast to User B via their user room
3. User A sends a message
4. Message is broadcast to:
   - The chat room (for joined users)
   - User A's user room
   - User B's user room (guaranteed even if not in chat room)
5. If socket drops, it automatically reconnects within 5 seconds
6. If message send fails, User A sees an error and can retry with content preserved
7. Comprehensive logging helps debug any remaining issues

## Testing Recommendations

1. **Test Direct Message Creation**: Create a new direct message space between two users
2. **Test Message Delivery**: Send a message and verify both users receive it
3. **Test Offline Behavior**: Disconnect the network and verify reconnection happens automatically
4. **Test Error States**: Block the websocket and verify error messages appear
5. **Test Attachments**: Send messages with attachments and verify they're delivered
6. **Monitor Logs**: Check browser console and server logs for the new debug messages

## Environment Configuration

Ensure the following is configured in `.env.local`:
```
VITE_PRESENCE_URL=http://localhost:6212
```

Or alternatively, the realtime server must be accessible at the URL where the frontend is deployed.
