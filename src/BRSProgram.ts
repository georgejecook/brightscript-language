import { BRSError, BRSCallable } from './interfaces';
import { BRSFile } from './BRSFile';
import { BRSContext } from './BRSContext';
import * as path from 'path';
import util from './util';
import { BRSConfig } from './BRSLanguageServer';

export class BRSProgram {
    constructor(
        /**
         * The root directory for this program
         */
        private options: BRSConfig
    ) {
        //normalize the root dir
        this.rootDir = util.getRootDir(options);

        //create the "global" context
        this.createContext('global', (file) => {
            //global context includes every file under the `source` folder
            return file.pathRelative.indexOf(`source${path.sep}`) === 0;
        });
    }

    private rootDir: string;

    /**
     * Get the list of errors for the entire program. It's calculated on the fly, so
     * call this sparingly.
     */
    public get errors() {
        let errorLists = [this._errors] as BRSError[][];
        for (let contextName in this.contexts) {
            let context = this.contexts[contextName];
            errorLists.push(context.errors);
        }
        let result = Array.prototype.concat.apply([], errorLists) as BRSError[];
        return result;
    }

    /**
     * List of errors found on this project
     */
    private _errors = [] as BRSError[];

    public files = {} as { [filePath: string]: BRSFile };

    public contexts = {} as { [name: string]: BRSContext };

    /**
     * Create a new context. 
     * @param name 
     * @param matcher called on every file operation to deteremine if that file should be included in the context.
     */
    private createContext(name, matcher: (file: BRSFile) => boolean | void) {
        let context = new BRSContext(name, matcher);
        //walk over every file to allow the context to include them
        for (let filePath in this.files) {
            let file = this.files[filePath];
            if (context.shouldIncludeFile(file)) {
                context.addFile(this.files[filePath]);
            }
        }
        this.contexts[name] = context;
    }

    /**
     * Add and parse all of the provided files
     * @param filePaths 
     */
    public async loadOrReloadFiles(filePaths: string[]) {
        await Promise.all(
            filePaths.map(async (filePath) => {
                await this.loadOrReloadFile(filePath);
            })
        );
    }

    /**
     * Load a file into the program, or replace it of it's already loaded
     * @param filePath 
     * @param fileContents 
     */
    public async loadOrReloadFile(filePath: string, fileContents?: string) {
        filePath = util.normalizeFilePath(filePath);
        //if the file is already loaded, remove it first
        if (this.files[filePath]) {
            await this.reloadFile(filePath, fileContents);
        } else {
            await this.loadFile(filePath, fileContents);
        }

    }

    private async loadFile(filePath: string, fileContents?: string) {
        filePath = util.normalizeFilePath(filePath);

        let relativeFilePath = filePath.replace(this.rootDir + path.sep, '');
        let file = new BRSFile(filePath, relativeFilePath);
        await file.parse(fileContents);
        this.files[filePath] = file;

        //notify all contexts of this new file
        for (let contextName in this.contexts) {
            let context = this.contexts[contextName];
            if (context.shouldIncludeFile(file)) {
                context.addFile(file);
            }
        }
    }

    private async reloadFile(filePath: string, fileContents?: string) {
        filePath = util.normalizeFilePath(filePath);
        let file = this.files[filePath];
        await file.reset();
        await file.parse(fileContents);
    }

    /**
     * Remove a set of files from the program
     * @param filePaths 
     */
    public async removeFiles(filePaths: string[]) {
        await Promise.all(
            filePaths.map(async (filePath) => {
                await this.removeFile(filePath);
            })
        );
    }

    /**
     * Remove a file from the program
     * @param filePath 
     */
    public removeFile(filePath: string) {
        filePath = path.normalize(filePath);
        let file = this.files[filePath];
        if (!file) {
            throw new Error(`File does not exist in project: ${filePath}`);
        }
        //notify every context of this file removal
        for (let contextName in this.contexts) {
            let context = this.contexts[contextName];
            context.removeFile(file)
        }
        //remove the file from the program
        delete this.files[filePath];
    }

    /**
     * Traverse the entire project, and validate all rules
     */
    public async validate() {
        for (let contextName in this.contexts) {
            let context = this.contexts[contextName];
            context.validate();
        }
    }
}