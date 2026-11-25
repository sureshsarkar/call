import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bell, BellOff, ChevronDown, Copy, Download, Edit3, FileText, Forward, ImagePlus, LogOut, Mic, MoreHorizontal, MoreVertical, Paperclip, Phone, Reply, Shield, Square, Trash2, UserMinus, UserPlus, Users, Video } from 'lucide-react';
import toast from 'react-hot-toast';
import Avatar from './Avatar';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import BottomSheet, { SheetAction } from './BottomSheet';
import { groupApi } from '../services/api';
import { useAuthStore } from '../context/authStore';
import { useChatStore } from '../context/chatStore';
import { useGroupStore } from '../context/groupStore';
import { useAppConfigStore } from '../context/appConfigStore';
import { formatDayLabel } from '../utils/format';
import { vibrate } from '../utils/haptics';
import { groupCallManager } from '../webrtc/GroupCallManager';

const idOf = (value) => String(value?._id ?? value ?? '');
const memberUser = (member) => member?.user || member;
const emojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function GroupAttachment({ groupId, attachment, mine }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const container = useRef(null);
  useEffect(() => {
    const node = container.current;
    if (!node || !('IntersectionObserver' in window)) { setVisible(true); return undefined; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '300px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return undefined;
    let disposed = false;
    let objectUrl = '';
    groupApi.downloadFile(groupId, attachment.fileId).then((blob) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [groupId, attachment.fileId, visible]);
  const size = attachment.size < 1024 * 1024 ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : `${(attachment.size / 1048576).toFixed(1)} MB`;
  if (failed) return <div className={`flex px-3 md:px-[8%] ${mine ? 'justify-end' : 'justify-start'}`}><p className="max-w-[85%] rounded-lg bg-panel2 px-3 py-2 text-xs text-mute">This attachment is unavailable.</p></div>;
  const card = !url ? <div className="grid h-24 w-56 place-items-center rounded-xl bg-panel3 text-xs text-mute">{visible ? 'Loading attachment…' : 'Attachment'}</div>
    : attachment.type === 'image' ? <img src={url} alt={attachment.name} className="max-h-80 max-w-full rounded-xl object-contain" />
      : attachment.type === 'video' ? <video src={url} controls playsInline className="max-h-80 max-w-full rounded-xl bg-black" />
        : attachment.type === 'audio' ? <audio src={url} controls className="max-w-full" />
          : <a href={url} download={attachment.name} className="flex w-full items-center gap-3 rounded-xl bg-panel3 p-3 text-left"><FileText size={26} className="shrink-0 text-brand" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{attachment.name}</span><span className="text-xs text-mute">{size}</span></span><Download size={18} className="text-mute" /></a>;
  return <div ref={container} className={`flex px-3 pb-1 md:px-[8%] ${mine ? 'justify-end' : 'justify-start'}`}><div className="max-w-[85%] overflow-hidden rounded-xl md:max-w-[65%]">{card}{attachment.type !== 'document' && <p className={`truncate px-1 pt-1 text-[11px] text-mute ${mine ? 'text-right' : ''}`}>{attachment.name} · {size}</p>}</div></div>;
}

export default function GroupChatWindow() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const me = useAuthStore((state) => state.user);
  const config = useAppConfigStore((state) => state.config);
  const groups = useGroupStore((state) => state.groups);
  const group = groups.find((item) => idOf(item._id) === String(groupId));
  const details = useGroupStore((state) => state.detailsById[groupId]);
  const thread = useGroupStore((state) => state.threads[groupId]);
  const typingIds = useGroupStore((state) => state.typing[groupId] || []);
  const contacts = useChatStore((state) => state.contacts);
  const users = useChatStore((state) => state.usersById);
  const [reply, setReply] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);
  const [showDown, setShowDown] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [receiptMessageId, setReceiptMessageId] = useState(null);
  const [forwardMessage, setForwardMessage] = useState(null);
  const [memberSheet, setMemberSheet] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const scroller = useRef(null);
  const stick = useRef(true);
  const fileInput = useRef(null);
  const recorder = useRef(null);
  const threadMessages = thread?.messages || [];
  const receiptMessage = threadMessages.find((message) => String(message._id) === String(receiptMessageId));
  const meId = String(me?._id || '');
  const myMember = group?.members?.find((entry) => idOf(memberUser(entry)) === meId);
  const isAdmin = ['owner', 'admin'].includes(myMember?.role);
  const memberIds = new Set((group?.members || []).map((entry) => idOf(memberUser(entry))));
  const addableContacts = contacts.map((id) => users[id]).filter((user) => user && !memberIds.has(idOf(user._id)));
  const canEditInfo = isAdmin || !group?.onlyAdminsCanEditInfo;

  useEffect(() => {
    setReply(null);
    setSelectedMessage(null);
    setReceiptMessageId(null);
    useGroupStore.getState().setActive(groupId);
    useGroupStore.getState().loadDetails(groupId).catch((error) => {
      toast.error(error.response?.data?.message || 'Group is unavailable');
      navigate('/', { replace: true });
    });
    stick.current = true;
    return () => useGroupStore.getState().setActive(null);
  }, [groupId, navigate]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [threadMessages.length, typingIds.length]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = fromBottom < 120;
    setShowDown(fromBottom > 400);
    if (el.scrollTop < 60 && thread?.hasMore && !thread.loading) useGroupStore.getState().loadHistory(groupId, true);
  };

  const onSend = useCallback((text, quoted) => {
    stick.current = true;
    void useGroupStore.getState().sendMessage(groupId, text, quoted);
    setReply(null);
  }, [groupId]);

  const uploadAttachment = async (file) => {
    if (!file) return;
    const maxMb = useGroupStore.getState().maxFileSizeMb || 25;
    if (file.size > maxMb * 1024 * 1024) { toast.error(`Files can be up to ${maxMb} MB`); return; }
    setUploading(true);
    try {
      const message = await useGroupStore.getState().sendAttachment(groupId, file, '', reply);
      if (message) { stick.current = true; setReply(null); }
    } finally { setUploading(false); }
  };

  const chooseAttachment = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    void uploadAttachment(file);
  };

  const toggleVoiceRecording = async () => {
    if (recording && recorder.current) { recorder.current.stop(); setRecording(false); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast.error('Voice messages are not supported by this browser'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => window.MediaRecorder.isTypeSupported?.(type));
      const mediaRecorder = options ? new MediaRecorder(stream, { mimeType: options }) : new MediaRecorder(stream);
      const chunks = [];
      mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (!chunks.length) return;
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: blob.type });
        await uploadAttachment(file);
      };
      mediaRecorder.start(); recorder.current = mediaRecorder; setRecording(true); vibrate(12);
    } catch { toast.error('Microphone access was not granted'); }
  };

  useEffect(() => () => {
    if (recorder.current && recorder.current.state !== 'inactive') {
      recorder.current.onstop = null;
      recorder.current.stream?.getTracks().forEach((track) => track.stop());
      recorder.current.stop();
    }
  }, []);

  const goToMessage = useCallback(async (messageId) => {
    let target = threadMessages.find((item) => String(item._id) === String(messageId));
    if (!target) {
      try {
        target = await groupApi.getMessage(groupId, messageId);
        useGroupStore.getState().insertMessage(groupId, target);
      } catch { toast.error('Original message is unavailable'); return; }
    }
    requestAnimationFrame(() => {
      const element = scroller.current?.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"]`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedId(String(messageId));
      setTimeout(() => setHighlightedId((current) => current === String(messageId) ? null : current), 1800);
    });
  }, [groupId, threadMessages]);

  const onGroupAction = async (action, message = selectedMessage) => {
    if (!message) return;
    try {
      if (action === 'reply') { setReply(message); setSelectedMessage(null); return; }
      if (action === 'forward') { setForwardMessage(message); setSelectedMessage(null); return; }
      if (action === 'edit') {
        const text = window.prompt('Edit message', message.text || '');
        if (text == null || !text.trim()) return;
        const updated = await groupApi.edit(groupId, message._id, text);
        useGroupStore.getState().onUpdated(updated);
      }
      if (action === 'delete') {
        if (!window.confirm('Delete this message for everyone in the group?')) return;
        await groupApi.remove(groupId, message._id);
      }
      if (action === 'report') {
        const reason = window.prompt('Why are you reporting this message?');
        if (reason?.trim()) { await groupApi.report(groupId, { messageId: message._id, reason: reason.trim() }); toast.success('Report sent to the administrators'); }
      }
      if (action.startsWith('react:')) {
        const updated = await groupApi.react(groupId, message._id, action.slice(6));
        useGroupStore.getState().onUpdated(updated);
      }
    } catch (error) { toast.error(error.response?.data?.message || 'Could not complete that action'); }
    finally { setSelectedMessage(null); }
  };

  const forwardToGroup = async (targetGroup) => {
    const message = forwardMessage;
    setForwardMessage(null);
    if (!message || message.deletedForEveryone || (!message.text && !message.attachment)) return;
    try {
      let sent;
      if (message.attachment) {
        const blob = await groupApi.downloadFile(groupId, message.attachment.fileId);
        const file = new File([blob], message.attachment.name, { type: message.attachment.mimeType });
        sent = await useGroupStore.getState().sendAttachment(targetGroup._id, file, message.text || '', null, true);
      } else sent = await useGroupStore.getState().sendMessage(targetGroup._id, message.text, null, true);
      if (sent) toast.success(`Forwarded to ${targetGroup.name}`);
    } catch (error) { toast.error(error.response?.data?.message || 'Could not forward this message'); }
  };

  const runGroupUpdate = async (fn, success) => {
    setBusy(true);
    try { await fn(); await useGroupStore.getState().refreshGroup(groupId); toast.success(success); }
    catch (error) { toast.error(error.response?.data?.message || 'Could not update the group'); }
    finally { setBusy(false); }
  };

  const editGroup = async (field, current, label) => {
    const value = window.prompt(label, current || '');
    if (value == null || (field === 'name' && value.trim().length < 2)) return;
    await runGroupUpdate(() => groupApi.update(groupId, { [field]: value.trim() }), 'Group updated');
  };

  const createInvite = async () => {
    try {
      const { inviteUrl } = await groupApi.invite(groupId, window.location.origin);
      await navigator.clipboard.writeText(inviteUrl);
      toast.success('Invite link copied');
    } catch { toast.error('Could not create or copy an invite link'); }
  };

  const addSelectedMembers = async () => {
    if (!selectedMembers.length) return;
    await runGroupUpdate(() => groupApi.addMembers(groupId, selectedMembers), 'Members added');
    setSelectedMembers([]); setMemberSheet(false);
  };

  const uploadGroupAvatar = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await groupApi.uploadAvatar(groupId, file); await useGroupStore.getState().refreshGroup(groupId); toast.success('Group picture updated'); }
    catch (error) { toast.error(error.response?.data?.message || 'Could not update group picture'); }
    event.target.value = '';
  };

  const requests = details?.joinRequests || [];
  const messagesWithDays = useMemo(() => {
    const items = []; let currentDay = '';
    for (const message of threadMessages) {
      const day = formatDayLabel(message.createdAt);
      if (day !== currentDay) { currentDay = day; items.push({ key: `day-${day}-${message._id}`, day }); }
      items.push({ key: message._id, message });
    }
    return items;
  }, [threadMessages]);

  if (config.features?.groupChat === false) return <div className="grid h-full place-items-center p-6 text-center text-sm text-mute">Group chat is temporarily disabled.</div>;
  if (!group) return <div className="grid h-full place-items-center text-sm text-mute">Loading group…</div>;

  const memberCount = group.members?.length || 0;

  return <div className="flex h-full min-h-0 flex-col">
    <header className="pt-safe flex items-center gap-2 bg-panel2 px-1 pb-2 md:gap-3 md:px-4">
      <button className="btn-icon h-11 w-11 shrink-0 md:hidden" onClick={() => navigate('/')} aria-label="Back"><ArrowLeft size={24} /></button>
      <Avatar user={{ name: group.name, avatar: group.avatar }} size={42} />
      <button className="ml-1 min-w-0 flex-1 text-left md:ml-0" onClick={() => setMenuOpen(true)}>
        <p className="truncate text-[16px] font-semibold leading-tight">{group.name}</p>
        <p className="truncate text-xs text-mute">{typingIds.length ? `${typingIds.length} typing…` : `${memberCount} members`}</p>
      </button>
      {config.features?.audioCalls !== false && <button className="btn-icon h-10 w-10 text-brand" title="Start group audio call" aria-label="Start group audio call" onClick={() => void groupCallManager.start(group, 'audio')}><Phone size={19} /></button>}
      {config.features?.videoCalls !== false && <button className="btn-icon h-10 w-10 text-brand" title="Start group video call" aria-label="Start group video call" onClick={() => void groupCallManager.start(group, 'video')}><Video size={20} /></button>}
      <button className="btn-icon h-11 w-11 text-mute" title="Group details" onClick={() => setMenuOpen(true)}><MoreVertical size={22} /></button>
    </header>

    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="chat-wallpaper h-full overflow-y-auto overscroll-contain py-3">
        {thread?.loading && <p className="py-2 text-center text-xs text-mute">Loading messages…</p>}
        {thread?.loaded && !threadMessages.length && <p className="mx-auto mt-8 max-w-xs rounded-2xl bg-panel2/80 px-4 py-2 text-center text-sm text-mute">This group is ready. Say hello 👋</p>}
        <div className="flex flex-col gap-1">
          {messagesWithDays.map((item) => item.day ? (
            <div key={item.key} className="my-2 flex justify-center"><span className="rounded-full bg-panel2 px-3 py-1 text-xs text-mute shadow">{item.day}</span></div>
          ) : (() => {
            const message = item.message;
            const mine = idOf(message.sender) === meId;
            const recipients = (group.members || []).filter((entry) => idOf(memberUser(entry)) !== meId).map((entry) => idOf(memberUser(entry)));
            const readBy = new Set((message.readBy || []).map(idOf));
            const deliveredBy = new Set((message.deliveredBy || []).map(idOf));
            const readByEveryone = recipients.length > 0 && recipients.every((id) => readBy.has(id));
            const deliveredToEveryone = recipients.length > 0 && recipients.every((id) => deliveredBy.has(id));
            const status = mine ? (readByEveryone ? 'seen' : deliveredToEveryone ? 'delivered' : message.status || 'sent') : undefined;
            const reactions = message.reactions || [];
            return <div key={item.key} className="group/message relative">
              {!mine && <p className="mb-0.5 px-5 text-[11px] font-medium text-brand md:px-[10%]">{message.sender?.name || 'Member'}</p>}
              {message.attachment && <GroupAttachment groupId={groupId} attachment={message.attachment} mine={mine} />}
              {message.forwarded && <p className={`px-5 pb-0.5 text-[10px] italic text-mute md:px-[10%] ${mine ? 'text-right' : ''}`}><Forward size={11} className="mr-1 inline" />Forwarded</p>}
              <button onClick={() => setSelectedMessage(message)} aria-label="Message actions" title="Message actions" className={`absolute top-1 z-10 hidden rounded-full bg-panel2 p-1 text-mute shadow hover:text-ink md:group-hover/message:grid ${mine ? 'right-[8%]' : 'left-[8%]'}`}><MoreHorizontal size={16} /></button>
              <MessageBubble message={{ ...message, status }} mine={mine}
                onDelete={(target) => setSelectedMessage(target)}
                onRetry={(target) => void useGroupStore.getState().retryMessage(groupId, target)}
                onLongPress={(target) => setSelectedMessage(target)}
                onReply={setReply} onQuoteNavigate={goToMessage}
                highlighted={highlightedId === String(message._id)} />
              {!!reactions.length && <div className={`-mt-0.5 flex px-5 md:px-[10%] ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className="flex flex-wrap gap-1">{reactions.map((reaction, index) => <button key={`${reaction.emoji}-${idOf(reaction.user)}-${index}`} onClick={() => void onGroupAction(`react:${reaction.emoji}`, message)} className="rounded-full border border-line bg-panel2 px-2 py-0.5 text-xs">{reaction.emoji}</button>)}</div>
              </div>}
            </div>;
          })())}
          {typingIds.length > 0 && <div className="px-3 md:px-[8%]"><div className="inline-flex gap-1 rounded-2xl rounded-tl-md bg-bubble-in px-3 py-3"><i className="dot" /><i className="dot" /><i className="dot" /></div></div>}
        </div>
      </div>
      {showDown && <button onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })} aria-label="Scroll to latest" className="press absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full bg-panel2 text-ink shadow-xl ring-1 ring-white/10"><ChevronDown size={24} /></button>}
    </div>

    {config.features?.chat === false && <p className="bg-amber-400/10 px-4 py-2 text-center text-xs text-amber-200">Messaging is temporarily disabled by an administrator.</p>}
    <MessageInput groupId={groupId} onSend={onSend} reply={reply} onCancelReply={() => setReply(null)} disabled={config.features?.chat === false || uploading} maxMessageLength={useGroupStore.getState().maxMessageLength}
      leadingActions={config.features?.fileSharing === false ? null : <div className="flex shrink-0 items-center">{!recording && <button className="btn-icon h-10 w-10 text-mute" title="Attach a photo, video or document" disabled={uploading} onClick={() => fileInput.current?.click()}><Paperclip size={21} /></button>}<input ref={fileInput} type="file" accept="image/*,video/*,audio/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip" className="hidden" onChange={chooseAttachment} /><button className={`btn-icon h-10 w-10 ${recording ? 'text-danger' : 'text-mute'}`} title={recording ? 'Stop recording and send' : 'Record voice message'} disabled={uploading} onClick={toggleVoiceRecording}>{recording ? <Square size={18} fill="currentColor" /> : <Mic size={20} />}</button>{uploading && <span className="px-1 text-[10px] text-brand">Sending…</span>}</div>} />

    <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Group details">
      <div className="flex items-center gap-3 border-b border-line px-4 pb-4">
        <div className="relative"><Avatar user={{ name: group.name, avatar: group.avatar }} size={64} />{canEditInfo && <label className="absolute -bottom-1 -right-1 grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-brand text-bg" title="Change group picture"><ImagePlus size={15} /><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={uploadGroupAvatar} /></label>}</div>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate font-semibold">{group.name}</h3>{canEditInfo && <button aria-label="Edit group name" onClick={() => editGroup('name', group.name, 'Group name')}><Edit3 size={15} className="text-mute" /></button>}</div><p className="text-xs text-mute">{memberCount} members · {myMember?.role || 'member'}</p><p className="mt-1 line-clamp-2 text-sm text-mute">{group.description || 'No group description'} {canEditInfo && <button className="text-brand" onClick={() => editGroup('description', group.description, 'Group description')}>Edit</button>}</p></div>
      </div>
      <div className="max-h-[45dvh] overflow-y-auto py-1">
        {isAdmin && <>
          <SheetAction icon={UserPlus} label="Add members" onClick={() => { setMenuOpen(false); setMemberSheet(true); }} />
          <SheetAction icon={Copy} label="Create and copy invite link" onClick={createInvite} />
          <SheetAction icon={Shield} label={`${group.onlyAdminsCanEditInfo ? 'Allow members' : 'Restrict members'} to edit info`} onClick={() => runGroupUpdate(() => groupApi.update(groupId, { onlyAdminsCanEditInfo: !group.onlyAdminsCanEditInfo }), 'Group settings updated')} />
          <SheetAction icon={Shield} label={`${group.approvalRequired ? 'Disable' : 'Require'} approval to join`} onClick={() => runGroupUpdate(() => groupApi.update(groupId, { approvalRequired: !group.approvalRequired }), 'Group settings updated')} />
        </>}
        <SheetAction icon={myMember?.muted ? Bell : BellOff} label={myMember?.muted ? 'Unmute notifications' : 'Mute notifications'} onClick={() => runGroupUpdate(() => groupApi.mute(groupId, !myMember?.muted), myMember?.muted ? 'Group unmuted' : 'Group muted')} />
        <div className="border-t border-line px-4 py-2 text-xs font-semibold uppercase tracking-wide text-mute">Members</div>
        {(group.members || []).map((entry) => {
          const user = memberUser(entry);
          const role = entry.role || 'member';
          const canManageTarget = isAdmin && idOf(user) !== meId && role !== 'owner' && (myMember?.role === 'owner' || role !== 'admin');
          return <div key={idOf(user)} className="flex items-center gap-3 px-4 py-2">
            <Avatar user={user} size={38} online={user.isOnline} />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{user.name}{idOf(user) === meId ? ' (you)' : ''}</p><p className="text-xs capitalize text-mute">{role}</p></div>
            {canManageTarget && <div className="flex shrink-0 items-center gap-1">
              <button className="rounded-md px-2 py-1 text-xs text-brand hover:bg-panel3" onClick={() => runGroupUpdate(() => groupApi.setMemberRole(groupId, idOf(user), role === 'admin' ? 'member' : 'admin'), role === 'admin' ? 'Admin role removed' : 'Member promoted')}>{role === 'admin' ? 'Demote' : 'Make admin'}</button>
              <button className="btn-icon h-8 w-8 text-danger" title="Remove member" onClick={() => { if (window.confirm(`Remove ${user.name} from this group?`)) runGroupUpdate(() => groupApi.removeMember(groupId, idOf(user)), 'Member removed'); }}><UserMinus size={16} /></button>
            </div>}
          </div>;
        })}
        {isAdmin && requests.length > 0 && <>
          <div className="border-t border-line px-4 py-2 text-xs font-semibold uppercase tracking-wide text-mute">Join requests</div>
          {requests.map((request) => <div key={request._id} className="flex items-center gap-3 px-4 py-2"><Avatar user={request.user} size={38} /><span className="min-w-0 flex-1 truncate text-sm">{request.user?.name || 'User'}</span><button className="rounded-md px-2 py-1 text-xs text-brand" onClick={() => runGroupUpdate(() => groupApi.requests(groupId, request._id, true), 'Request approved')}>Approve</button><button className="rounded-md px-2 py-1 text-xs text-danger" onClick={() => runGroupUpdate(() => groupApi.requests(groupId, request._id, false), 'Request declined')}>Decline</button></div>)}
        </>}
        {details?.activity?.length > 0 && <div className="border-t border-line px-4 py-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute">Recent activity</p>{details.activity.slice(0, 8).map((entry) => <p key={entry._id} className="py-1 text-xs text-mute">{entry.actor?.name || 'A member'} · {entry.action.replaceAll('_', ' ')}</p>)}</div>}
        <SheetAction icon={LogOut} danger label="Leave group" onClick={() => { if (window.confirm('Leave this group?')) runGroupUpdate(async () => { await groupApi.leave(groupId); useGroupStore.getState().removeGroup(groupId); navigate('/'); }, 'You left the group'); }} />
      </div>
    </BottomSheet>

    <BottomSheet open={memberSheet} onClose={() => setMemberSheet(false)} title="Add members">
      <div className="max-h-[50dvh] overflow-y-auto px-4">
        {addableContacts.map((user) => <label key={user._id} className="flex cursor-pointer items-center gap-3 border-b border-line py-2.5"><input type="checkbox" checked={selectedMembers.includes(user._id)} onChange={(event) => setSelectedMembers((current) => event.target.checked ? [...current, user._id] : current.filter((id) => id !== user._id))} className="h-4 w-4 accent-emerald-500" /><Avatar user={user} size={38} /><span className="truncate text-sm">{user.name}</span></label>)}
        {!addableContacts.length && <p className="py-6 text-center text-sm text-mute">No contacts available to add.</p>}
      </div>
      <div className="flex items-center justify-between px-4 py-3 text-xs text-mute"><span>Maximum {useGroupStore.getState().maxMembers} members</span><button disabled={!selectedMembers.length || busy} onClick={addSelectedMembers} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-bg disabled:opacity-50">{busy ? 'Adding…' : `Add ${selectedMembers.length || ''} member${selectedMembers.length === 1 ? '' : 's'}`}</button></div>
    </BottomSheet>

    <BottomSheet open={Boolean(selectedMessage)} onClose={() => setSelectedMessage(null)} title={selectedMessage ? `${selectedMessage.sender?.name || 'Message'} · ${selectedMessage.text?.slice(0, 50) || 'Message'}` : ''}>
      {selectedMessage && <>
        <div className="flex justify-center gap-2 px-4 py-2">{emojis.map((emoji) => <button key={emoji} onClick={() => void onGroupAction(`react:${emoji}`)} className="rounded-full bg-panel3 px-2.5 py-2 text-xl">{emoji}</button>)}</div>
        <SheetAction icon={Reply} label="Reply" onClick={() => void onGroupAction('reply')} />
        <SheetAction icon={Forward} label="Forward" onClick={() => void onGroupAction('forward')} />
        {idOf(selectedMessage.sender) === meId && <SheetAction icon={Users} label="Message info" onClick={() => { setReceiptMessageId(selectedMessage._id); setSelectedMessage(null); }} />}
        {idOf(selectedMessage.sender) === meId && !selectedMessage.deletedForEveryone && <SheetAction icon={Edit3} label="Edit message" onClick={() => void onGroupAction('edit')} />}
        {(idOf(selectedMessage.sender) === meId || isAdmin) && <SheetAction icon={Trash2} danger label="Delete for everyone" onClick={() => void onGroupAction('delete')} />}
        <SheetAction icon={Shield} label="Report message" onClick={() => void onGroupAction('report')} />
      </>}
    </BottomSheet>

    <BottomSheet open={Boolean(receiptMessageId)} onClose={() => setReceiptMessageId(null)} title="Message info">
      {receiptMessage && <div className="max-h-[55dvh] overflow-y-auto px-4 pb-3">
        <p className="mb-3 truncate rounded-lg bg-panel3 px-3 py-2 text-sm">{receiptMessage.text || receiptMessage.attachment?.name || 'Media message'}</p>
        {(group.members || []).filter((entry) => idOf(memberUser(entry)) !== meId).map((entry) => {
          const user = memberUser(entry);
          const id = idOf(user);
          const isRead = (receiptMessage.readBy || []).some((value) => idOf(value) === id);
          const isDelivered = (receiptMessage.deliveredBy || []).some((value) => idOf(value) === id);
          return <div key={id} className="flex items-center gap-3 border-b border-line py-2.5"><Avatar user={user} size={36} online={user.isOnline} /><span className="min-w-0 flex-1 truncate text-sm">{user.name}</span><span className={`text-xs ${isRead ? 'text-brand' : 'text-mute'}`}>{isRead ? 'Read' : isDelivered ? 'Delivered' : 'Sent'}</span></div>;
        })}
      </div>}
    </BottomSheet>

    <BottomSheet open={Boolean(forwardMessage)} onClose={() => setForwardMessage(null)} title="Forward message to">
      {(useGroupStore.getState().groups || []).map((targetGroup) => <button key={targetGroup._id} onClick={() => void forwardToGroup(targetGroup)} className="press flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left hover:bg-panel3"><Avatar user={{ name: targetGroup.name, avatar: targetGroup.avatar }} size={42} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{targetGroup.name}</span><span className="block text-xs text-mute">{targetGroup.members?.length || 0} members</span></span></button>)}
    </BottomSheet>
  </div>;
}
