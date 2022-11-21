#!/usr/bin/env node

// import { SpotterPlugin, Option } from '@spotter-app/core';

import WebSocket from 'websocket';

export interface Option {
  name: string;
  hint?: string;
  action?: Action;
  onQuery?: OnQuery;
  icon?: string;
  isHovered?: boolean,
  priority?: number,
  important?: boolean,
}

export type OnQuery = (query: string) => Promise<Option[]> | Option[];

export type Action = () => Promise<Option[] | boolean> | Option[] | boolean;

export interface MappedOption {
  name: string;
  hint?: string;
  actionId?: string;
  onQueryId?: string;
  icon?: string;
  isHovered?: boolean,
  priority?: number,
  important?: boolean,
};

enum RequestFromSpotterType {
  onQuery = 'onQuery',
  onOptionQuery = 'onOptionQuery',
  execAction = 'execAction',
  mlOnGlobalActionPath = 'mlOnGlobalActionPath',
  onOpenSpotter = 'onOpenSpotter',
};

interface RequestFromSpotter {
  id: string,
  type: RequestFromSpotterType,
  query: string,
  actionId: string,
  onQueryId: string,
  mlGlobalActionPath?: string,
};

interface RequestFromPlugin {
  id: string,
  options: MappedOption[],
  complete: boolean,
  // TODO: probably rename key to 'data' and set request type
  mlGlobalActionPath?: string,
};

const generateId = () => Math.random().toString(16).slice(2);

export class SpotterPlugin {
  private actionsMap: {[actionId: string]: Action} = {};
  private onQueryMap: {[onQueryId: string]: OnQuery} = {};
  private client = new WebSocket.client();
  private connection?: WebSocket.connection;

  constructor() {
    this.spotterInitServer();
  }

  private async connect(): Promise<WebSocket.connection> {
    this.client.connect('ws://0.0.0.0:4040');
    return new Promise(resolve => {
      this.client.on('connect', (cl) => {
        resolve(cl);
      });
    });
  }

  private async spotterInitServer() {
    this.connection = await this.connect();

    this.connection.on('message', async (msg: any) => {
      const request: RequestFromSpotter = JSON.parse(msg.utf8Data);
      
      if (request.type === RequestFromSpotterType.onOpenSpotter) {
        this.onOpenSpotter();
        return;
      }

      if (request.type === RequestFromSpotterType.mlOnGlobalActionPath) {
        if (request?.mlGlobalActionPath) {
          this.mlOnGlobalActionPath(request.mlGlobalActionPath);
        }
        return;
      }
      
      if (request.type === RequestFromSpotterType.onQuery) {
        const nextOptions: Option[] = this.onQuery(request.query);
        const mappedOptions = this.spotterMapOptions(nextOptions);
        const response: RequestFromPlugin = {
          id: request.id,
          options: mappedOptions,
          complete: false,
        };
        this.connection?.send(JSON.stringify(response));
        return;
      }

      if (request.type === RequestFromSpotterType.execAction) {
        const result = await this.actionsMap[request.actionId]();

        // TODO: move to function
        if (typeof result === 'boolean') {
          const response: RequestFromPlugin = {
            id: request.id,
            options: [],
            complete: result,
          };
          this.connection?.send(JSON.stringify(response));
          return;
        };

        const mappedOptions = this.spotterMapOptions(result as Option[]);
        const response: RequestFromPlugin = {
          id: request.id,
          options: mappedOptions,
          complete: false,
        };
        this.connection?.send(JSON.stringify(response));
        return;
      }

      if (request.type === RequestFromSpotterType.onOptionQuery) {
        const nextOptions = await this.onQueryMap[request.onQueryId](request.query);

        if (typeof nextOptions === 'boolean') {
          const response: RequestFromPlugin = {
            id: request.id,
            options: [],
            complete: nextOptions,
          };
          this.connection?.send(JSON.stringify(response));
          return;
        };

        const mappedOptions = this.spotterMapOptions(nextOptions as Option[]);
        const response: RequestFromPlugin = {
          id: request.id,
          options: mappedOptions,
          complete: false,
        };
        this.connection?.send(JSON.stringify(response));
        return;
      }
    });

    this.client.on('connectFailed', (reason) => {
      console.log('connectFailed: ', reason);
    });
  }

  private spotterMapOptions(options: Option[]): MappedOption[] {
    // TODO: optimize
    // this.actionsMap = {};
    // this.onQueryMap = {};

    return options.map(({
      name,
      hint,
      icon,
      action,
      onQuery,
      isHovered,
      priority,
      important,
    }) => {
      const mappedOption: MappedOption = {
        name: `${name}`,
        hint,
        icon,
        isHovered,
        priority,
        important,
      };

      if (action) {
        const actionId = generateId();
        this.actionsMap[actionId] = action;
        mappedOption.actionId = actionId;
      }

      if (onQuery) {
        const onQueryId = generateId();
        this.onQueryMap[onQueryId] = onQuery;
        mappedOption.onQueryId = onQueryId;
      }

      return mappedOption;
    });
  }

  public mlOnGlobalActionPath(_: string): void {}

  public mlSuggestActionPath(actionPath: string): void {
    if (!this.connection) {
      return;
    }

    const request: RequestFromPlugin = {
      id: '',
      options: [],
      complete: false,
      mlGlobalActionPath: actionPath,
    };
    this.connection?.send(JSON.stringify(request));
  }

  public onOpenSpotter(): void {}

  public onQuery(_: string): Option[] {
    return [];
  }
}

import ActiveWindow from '@paymoapp/active-window';
import { uptime } from 'os';


if (!ActiveWindow.requestPermissions()) {
	console.log('Error: You need to grant screen recording permission in System Preferences > Security & Privacy > Privacy > Screen Recording');
	process.exit(0);
}

const activeWin = ActiveWindow.getActiveWindow();

// ActiveWindow.unsubscribe();

// console.log('Window title:', activeWin.title);
// console.log('Application:', activeWin.application);
// console.log('Application path:', activeWin.path);
// console.log('Application PID:', activeWin.pid);
// console.log('Application icon:', activeWin.icon);

import { existsSync, writeFileSync, readFileSync } from 'fs';

import ncp from 'node-clipboardy';

interface MLDataItem {
  uptime: number;
  activeWindowsHistory: string[];
  actionPath: string;
}

interface JSONData {
  data: MLDataItem[];
}

const DB_FILE_NAME = 'db.json';
const DB_LAST_ACTIVE_WINDOWS_LIMIT = 50;

new class MLPlugin extends SpotterPlugin {
  private activeWindowsHistory: string[] = [];

	constructor() {
		super();
		this.init();
	}

	private init() {
    ActiveWindow.initialize();

    ActiveWindow.subscribe((windowInfo) => {
      if (!windowInfo?.title) {
        return;
      }

      if (this.activeWindowsHistory.length >= DB_LAST_ACTIVE_WINDOWS_LIMIT) {
        this.activeWindowsHistory = [
          ...this.activeWindowsHistory.slice(0, DB_LAST_ACTIVE_WINDOWS_LIMIT),
          windowInfo.title,
        ];
        return;
      }

      this.activeWindowsHistory.push(windowInfo.title);
    });
	}

  private appendData(dataItem: MLDataItem) {
    const currentData: JSONData = this.getData();
    const nextData: JSONData = {
      data: [...currentData.data, dataItem],
    }
    writeFileSync(DB_FILE_NAME, JSON.stringify(nextData));
  }

  private getData(): JSONData {
    if (existsSync(DB_FILE_NAME)) {
      const rawData = readFileSync(DB_FILE_NAME);
      return JSON.parse(rawData.toString());
    }

    const defaultJsonData: JSONData = {
      data: [],
    };
    writeFileSync(DB_FILE_NAME, JSON.stringify(defaultJsonData));
    return defaultJsonData;
  }
  
  public onOpenSpotter(): void {
    console.log('open spotter!!!');
  }

  public onQuery(query: string): Option[] {
    console.log(query);
    if (query === '-ml') {
      const data = this.getData();
      return [{
        name: '-ml',
        action: async () => {
          ncp.writeSync(JSON.stringify(data));
          return true;
        }
      }]
    }

    return [];
  }

  public mlOnGlobalActionPath(actionPath: string): void {
    this.appendData({
      activeWindowsHistory: this.activeWindowsHistory,
      uptime: uptime(),
      actionPath,
    });
    console.log(actionPath);
  }

  // public onQuery(_: string): Option[] {
  //   // this.mlSuggestActionPath('test123213');
  //   return [{ name: 'hey', }]
  // }
}
