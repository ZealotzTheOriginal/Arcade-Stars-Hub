import { Component, Input, OnChanges, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
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
export class ChatComponent implements AfterViewChecked, OnChanges {
  @Input() messages: ChatMessage[] = [];
  @Input() roomId: string = '';
  @Input() displayName: string = '';
  @Input() myUid: string = '';

  @ViewChild('msgList') private msgList!: ElementRef;

  text = '';
  private shouldScroll = false;

  constructor(private ws: WsService) {}

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  ngOnChanges() {
    this.shouldScroll = true;
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
    if (this.msgList?.nativeElement) {
      this.msgList.nativeElement.scrollTop = this.msgList.nativeElement.scrollHeight;
    }
  }
}
