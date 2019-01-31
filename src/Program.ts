import { Diagnostic, Callable, File } from './interfaces';
import { BrsFile } from './files/BrsFile';
import { Context } from './Context';
import * as path from 'path';
import util from './util';
import { BRSConfig } from './ProgramBuilder';
import { XmlFile } from './files/XmlFile';

export class Program {
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
        let errorLists = [this._errors] as Diagnostic[][];
        for (let contextName in this.contexts) {
            let context = this.contexts[contextName];
            errorLists.push(context.diagnostics);
        }
        let result = Array.prototype.concat.apply([], errorLists) as Diagnostic[];
        return result;
    }

    /**
     * List of errors found on this project
     */
    private _errors = [] as Diagnostic[];

    public files = {} as { [filePath: string]: BrsFile | XmlFile };

    public contexts = {} as { [name: string]: Context };

    /**
     * Determine if the specified file is loaded in this program right now.
     * @param filePath 
     */
    public hasFile(filePath: string) {
        filePath = util.normalizeFilePath(filePath);
        return this.files[filePath] !== undefined;
    }

    /**
     * Create a new context. 
     * @param name 
     * @param matcher called on every file operation to deteremine if that file should be included in the context.
     */
    private createContext(name, matcher: (file: File) => boolean | void) {
        let context = new Context(name, matcher);
        //walk over every file to allow the context to include them
        for (let filePath in this.files) {
            let file = this.files[filePath];
            if (context.shouldIncludeFile(file)) {
                context.addFile(this.files[filePath]);
            }
        }
        this.contexts[name] = context;
        return context;
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
     * @param filePathAbsolute 
     * @param fileContents 
     */
    public async loadOrReloadFile(filePathAbsolute: string, fileContents?: string) {
        filePathAbsolute = util.normalizeFilePath(filePathAbsolute);
        //if the file is already loaded, remove it first
        if (this.files[filePathAbsolute]) {
            await this.reloadFile(filePathAbsolute, fileContents);
        } else {
            await this.loadFile(filePathAbsolute, fileContents);
        }

    }

    private async loadFile(pathAbsolute: string, fileContents?: string) {
        pathAbsolute = util.normalizeFilePath(pathAbsolute);
        let pathRelative = pathAbsolute.replace(this.rootDir + path.sep, '');
        let fileExtension = path.extname(pathAbsolute).toLowerCase();
        let file: any;

        //get the extension of the file
        if (fileExtension === '.brs' || fileExtension === '.bs') {
            let brsFile = new BrsFile(pathAbsolute, pathRelative);
            await brsFile.parse(fileContents);
            this.files[pathAbsolute] = brsFile;
            file = brsFile;
        } else if (fileExtension === '.xml') {
            let xmlFile = new XmlFile(pathAbsolute, pathRelative);
            await xmlFile.parse(fileContents);
            file = xmlFile;
            this.createContext(xmlFile.pathRelative, xmlFile.doesReferenceFile.bind(xmlFile));
        } else {
            file = {
                pathAbsolute: pathAbsolute,
                pathRelative: pathRelative,
                wasProcessed: true
            }
        }

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
        //remove the file from all contexts
        for (let contextName in this.contexts) {
            let context = this.contexts[contextName];
            if (context.files[filePath]) {
                context.removeFile(file);
            }
        }

        await file.reset();
        await file.parse(fileContents);

        //add the file back to the context
        for (let contextName in this.contexts) {
            let context = this.contexts[contextName];
            if (context.shouldIncludeFile(file)) {
                context.addFile(file);
            }
        }
    }

    /**
     * Remove a set of files from the program
     * @param filePaths 
     */
    public removeFiles(filePaths: string[]) {
        for (let filePath of filePaths) {
            this.removeFile(filePath);
        }
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