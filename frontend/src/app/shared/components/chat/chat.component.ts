import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, ViewChild, ElementRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WsService } from '../../../core/services/ws.service';
import { ChatMessage } from '../../../core/models/ws-events.model';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
})
export class ChatComponent implements OnChanges {
  @Input() messages: ChatMessage[] = [];
  @Input() roomId: string = '';
  @Input() displayName: string = '';
  @Input() myUid: string = '';

  @Output() openChange = new EventEmitter<boolean>();

  @ViewChild('msgList') private msgList?: ElementRef;

  text = '';
  open = signal(false);
  renderContent = signal(false);
  unread = signal(0);
  private prevMsgCount = 0;
  private openTimer?: ReturnType<typeof setTimeout>;

  constructor(private ws: WsService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['messages']) {
      const newCount = this.messages.length;
      const added = newCount - this.prevMsgCount;
      if (added > 0) {
        if (!this.open()) {
          this.unread.update(n => n + added);
        } else {
          setTimeout(() => this.scrollToBottom(), 0);
        }
      }
      this.prevMsgCount = newCount;
    }
  }

  toggle() {
    this.open.update(v => !v);
    this.openChange.emit(this.open());

    if (this.open()) {
      this.unread.set(0);
      // Wait for the width transition (300ms) before adding content to DOM
      // so the layout jump from new elements never happens
      this.openTimer = setTimeout(() => {
        this.renderContent.set(true);
        setTimeout(() => this.scrollToBottom(), 0);
      }, 300);
    } else {
      clearTimeout(this.openTimer);
      this.renderContent.set(false);
    }
  }

  isFirstInGroup(index: number): boolean {
    if (index === 0) return true;
    return this.messages[index].uid !== this.messages[index - 1].uid;
  }

  isMine(msg: ChatMessage): boolean {
    return msg.uid === this.myUid;
  }

  send() {
    const msg = this.text.trim();
    if (!msg || !this.roomId) return;
    this.ws.send('chat_message', { room_id: this.roomId, message: msg, display_name: this.displayName });
    this.text = '';
  }

  onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  }

  private scrollToBottom() {
    const el = this.msgList?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }
}
