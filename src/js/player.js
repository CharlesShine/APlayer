import Promise from 'promise-polyfill';

import utils from './utils';
import Icons from './icons';
import handleOption from './options';
import Template from './template';
import Bar from './bar';
import User from './user';
import Lrc from './lrc';
import Controller from './controller';
import Timer from './timer';
import Events from './events';
import List from './list';

const instances = [];

class APlayer {

    /**
     * APlayer constructor function
     *
     * @param {Object} options - See README
     * @constructor
     */
    constructor (options) {
        this.options = handleOption(options);
        this.container = this.options.container;
        this.paused = true;
        this.playedPromise = Promise.resolve();
        this.mode = 'normal';

        this.randomOrder = utils.randomOrder(this.options.audio.length);

        this.container.classList.add('aplayer');
        if (this.options.lrcType) {
            this.container.classList.add('aplayer-withlrc');
        }
        if (this.options.audio.length > 1) {
            this.container.classList.add('aplayer-withlist');
        }
        if (utils.isMobile) {
            this.container.classList.add('aplayer-mobile');
        }
        this.arrow = this.container.offsetWidth <= 300;
        if (this.arrow) {
            this.container.classList.add('aplayer-arrow');
        }
        if (this.options.mini) {
            this.setMode('mini');
        }

        // save lrc
        this.container = this.options.container;
        if (this.options.lrcType === 2 || this.options.lrcType === true) {
            const lrcEle = this.container.getElementsByClassName('aplayer-lrc-content');
            for (let i = 0; i < lrcEle.length; i++) {
                if (this.options.audio[i]) {
                    this.options.audio[i].lrc = lrcEle[i].innerHTML;
                }
            }
        }

        this.template = new Template({
            container: this.container,
            options: this.options,
            randomOrder: this.randomOrder,
        });

        if (this.template.info.offsetWidth < 200) {
            this.template.time.classList.add('aplayer-time-narrow');
        }

        if (this.options.lrcType) {
            this.lrc = new Lrc({
                container: this.template.lrc,
                async: this.options.lrcType === 3,
                content: this.options.audio.map((item) => item.lrc),
                player: this,
            });
        }
        this.events = new Events();
        this.user = new User(this);
        this.bar = new Bar(this.template);
        this.controller = new Controller(this);
        this.timer = new Timer(this);
        this.list = new List(this);

        this.initAudio();
        if (this.options.order === 'random') {
            this.list.switch(this.randomOrder[0]);
        }
        else {
            this.list.switch(0);
        }

        // autoplay
        if (this.options.autoplay) {
            this.play();
        }

        instances.push(this);
    }

    initAudio () {
        this.audio = document.createElement('audio');
        this.audio.preload = this.options.preload;

        for (let i = 0; i < this.events.audioEvents.length; i++) {
            this.audio.addEventListener(this.events.audioEvents[i], (e) => {
                this.events.trigger(this.events.audioEvents[i], e);
            });
        }

        this.on('play', () => {
            if (this.paused) {
                this.setUIPlaying();
            }
        });

        this.on('pause', () => {
            if (!this.paused) {
                this.setUIPaused();
            }
        });

        this.on('timeupdate', () => {
            if (!this.disableTimeupdate) {
                this.bar.set('played', this.audio.currentTime / this.audio.duration, 'width');
                this.lrc && this.lrc.update();
                const currentTime = utils.secondToTime(this.audio.currentTime);
                if (this.template.ptime.innerHTML !== currentTime) {
                    this.template.ptime.innerHTML = currentTime;
                }
            }
        });

        // show audio time: the metadata has loaded or changed
        this.on('durationchange', () => {
            if (this.audio.duration !== 1) {           // compatibility: Android browsers will output 1 at first
                this.template.dtime.innerHTML = utils.secondToTime(this.audio.duration);
            }
        });

        // show audio loaded bar: to inform interested parties of progress downloading the media
        this.on('progress', () => {
            const percentage = this.audio.buffered.length ? this.audio.buffered.end(this.audio.buffered.length - 1) / this.audio.duration : 0;
            this.bar.set('loaded', percentage, 'width');
        });

        // audio download error: an error occurs
        this.on('error', () => {
            this.notice('An audio error has occurred.');
        });

        // multiple audio play
        this.on('ended', () => {
            if (this.options.loop === 'none') {
                if (this.options.order === 'list') {
                    if (this.list.index < this.list.audios.length - 1) {
                        this.list.switch((this.list.index + 1) % this.list.audios.length);
                        this.play();
                    }
                    else {
                        this.list.switch((this.list.index + 1) % this.list.audios.length);
                        this.pause();
                    }
                }
                else if (this.options.order === 'random') {
                    if (this.randomOrder.indexOf(this.list.index) < this.randomOrder.length - 1) {
                        this.list.switch(this.nextRandomNum());
                        this.play();
                    }
                    else {
                        this.list.switch(this.nextRandomNum());
                        this.pause();
                    }
                }
            }
            else if (this.options.loop === 'one') {
                this.list.switch(this.list.index);
                this.play();
            }
            else if (this.options.loop === 'all') {
                if (this.options.order === 'list') {
                    this.list.switch((this.list.index + 1) % this.list.audios.length);
                }
                else if (this.options.order === 'random') {
                    this.list.switch(this.nextRandomNum());
                }
                this.play();
            }
        });

        this.volume(this.user.get('volume'), true);
    }

    setAudio (audio) {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        let type = audio.type;
        if (this.options.customAudioType && this.options.customAudioType[type]) {
            if (Object.prototype.toString.call(this.options.customAudioType[type]) === '[object Function]') {
                this.options.customAudioType[type](this.audio, audio, this);
            }
            else {
                console.error(`Illegal customType: ${type}`);
            }
        }
        else {
            if (!type || type === 'auto') {
                if (/m3u8(#|\?|$)/i.exec(audio.url)) {
                    type = 'hls';
                }
                else {
                    type = 'normal';
                }
            }
            if (type === 'hls') {
                if (Hls.isSupported()) {
                    this.hls = new Hls();
                    this.hls.loadSource(audio.url);
                    this.hls.attachMedia(this.audio);
                }
                else if (this.audio.canPlayType('application/x-mpegURL') || this.audio.canPlayType('application/vnd.apple.mpegURL')) {
                    this.audio.src = audio.url;
                }
                else {
                    this.notice('Error: HLS is not supported.');
                }
            }
            else if (type === 'normal') {
                this.audio.src = audio.url;
            }
        }
        this.seek(0);

        if (!this.paused) {
            this.audio.play();
        }
    }

    theme (color = this.list.audios[this.list.index].theme || this.options.theme, index = this.list.index) {
        this.list.audios[index].theme = color;
        this.template.listCurs[index].style.backgroundColor = color;
        if (index === this.list.index) {
            this.template.pic.style.backgroundColor = color;
            this.template.played.style.background = color;
            this.template.thumb.style.background = color;
            this.template.volume.style.background = color;
        }
    }

    seek (time) {
        time = Math.max(time, 0);
        if (this.audio.duration) {
            time = Math.min(time, this.audio.duration);
        }

        this.audio.currentTime = time;

        if (isNaN(this.audio.duration)) {
            this.bar.set('played', 0, 'width');
        }
        else {
            this.bar.set('played', time / this.audio.duration, 'width');
        }
        this.template.ptime.innerHTML = utils.secondToTime(time);
    }

    setUIPlaying () {
        if (this.paused) {
            this.paused = false;
            this.template.button.classList.remove('aplayer-play');
            this.template.button.classList.add('aplayer-pause');
            this.template.button.innerHTML = '';
            setTimeout(() => {
                this.template.button.innerHTML = Icons.pause;
            }, 100);
        }

        this.timer.enable('loading');

        if (this.options.mutex) {
            for (let i = 0; i < instances.length; i++) {
                if (this !== instances[i]) {
                    instances[i].pause();
                }
            }
        }
    }

    play () {
        this.setUIPlaying();

        const playPromise = this.audio.play();
        if (playPromise) {
            playPromise.catch((e) => {
                console.error(e);
                if (e.name === 'NotAllowedError' ||
                    e.name === 'NotSupportedError') {
                    this.setUIPaused();
                }
            });
        }
    }

    setUIPaused () {
        if (!this.paused) {
            this.paused = true;

            this.template.button.classList.remove('aplayer-pause');
            this.template.button.classList.add('aplayer-play');
            this.template.button.innerHTML = '';
            setTimeout(() => {
                this.template.button.innerHTML = Icons.play;
            }, 100);
        }

        this.container.classList.remove('aplayer-loading');
        this.timer.disable('loading');
    }

    pause () {
        this.setUIPaused();
        this.audio.pause();
    }

    switchVolumeIcon () {
        if (this.volume() >= 0.95) {
            this.template.volumeButton.innerHTML = Icons.volumeUp;
        }
        else if (this.volume() > 0) {
            this.template.volumeButton.innerHTML = Icons.volumeDown;
        }
        else {
            this.template.volumeButton.innerHTML = Icons.volumeOff;
        }
    }

    /**
     * Set volume
     */
    volume (percentage, nostorage) {
        percentage = parseFloat(percentage);
        if (!isNaN(percentage)) {
            percentage = Math.max(percentage, 0);
            percentage = Math.min(percentage, 1);
            this.bar.set('volume', percentage, 'height');
            if (!nostorage) {
                this.user.set('volume', percentage);
            }

            this.audio.volume = percentage;
            if (this.audio.muted) {
                this.audio.muted = false;
            }

            this.switchVolumeIcon();
        }

        return this.audio.muted ? 0 : this.audio.volume;
    }

    /**
     * bind events
     */
    on (name, callback) {
        this.events.on(name, callback);
    }

    /**
     * toggle between play and pause
     */
    toggle () {
        if (this.template.button.classList.contains('aplayer-play')) {
            this.play();
        }
        else if (this.template.button.classList.contains('aplayer-pause')) {
            this.pause();
        }
    }

    /**
     * get next random number
     */
    nextRandomNum () {
        if (this.list.audios.length > 1) {
            const index = this.randomOrder.indexOf(this.list.index);
            if (index === this.randomOrder.length - 1) {
                return this.randomOrder[0];
            }
            else {
                return this.randomOrder[index + 1];
            }
        }
        else {
            return 0;
        }
    }

    // abandoned
    switchAudio (index) {
        this.list.switch(index);
    }

    // abandoned
    addAudio (audios) {
        this.list.add(audios);
    }

    // abandoned
    removeAudio (index) {
        this.list.remove(index);
    }

    /**
     * destroy this player
     */
    destroy () {
        instances.splice(instances.indexOf(this), 1);
        this.pause();
        this.container.innerHTML = '';
        this.audio.src = '';
        this.timer.destroy();
        this.events.trigger('destroy');
    }

    setMode (mode = 'normal') {
        this.mode = mode;
        if (mode === 'mini') {
            this.container.classList.add('aplayer-narrow');
        }
        else if (mode === 'normal') {
            this.container.classList.remove('aplayer-narrow');
        }
    }

    notice (text, time = 2000, opacity = 0.8) {
        this.template.notice.innerHTML = text;
        this.template.notice.style.opacity = opacity;
        if (this.noticeTime) {
            clearTimeout(this.noticeTime);
        }
        this.events.trigger('notice_show', text);
        if (time) {
            this.noticeTime = setTimeout(() => {
                this.template.notice.style.opacity = 0;
                this.events.trigger('notice_hide');
            }, time);
        }
    }

    static get version () {
        /* global APLAYER_VERSION */
        return APLAYER_VERSION;
    }
}

export default APlayer;
