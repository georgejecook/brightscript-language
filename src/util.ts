import * as brs from 'brs';
import chalk from 'chalk';
import * as fsExtra from 'fs-extra';
import * as moment from 'moment';
import * as path from 'path';
import * as rokuDeploy from 'roku-deploy';
import { DiagnosticSeverity, Position, Range } from 'vscode-languageserver';
import Uri from 'vscode-uri';
import * as xml2js from 'xml2js';

import { BrsConfig } from './BrsConfig';
import { BrsFile } from './files/BrsFile';
import { CallableContainer, Diagnostic, ValueKind } from './interfaces';
import { BooleanType } from './types/BooleanType';
import { BrsType } from './types/BrsType';
import { DoubleType } from './types/DoubleType';
import { DynamicType } from './types/DynamicType';
import { FloatType } from './types/FloatType';
import { FunctionType } from './types/FunctionType';
import { IntegerType } from './types/IntegerType';
import { InvalidType } from './types/InvalidType';
import { LongIntegerType } from './types/LongIntegerType';
import { ObjectType } from './types/ObjectType';
import { StringType } from './types/StringType';
import { UninitializedType } from './types/UninitializedType';
import { VoidType } from './types/VoidType';

class Util {
    public log(...args) {
        //print an empty line
        console.log('');
        let timestamp = '[' + chalk.grey(moment().format('hh:mm:ss A')) + ']';
        console.log.apply(console.log, [timestamp, ...args]);
        //print an empty line
        console.log('');
    }
    public clearConsole() {
        process.stdout.write('\x1Bc');
    }

    /**
     * Determine if the file exists
     * @param filePath
     */
    public fileExists(filePath: string) {
        return new Promise((resolve, reject) => {
            fsExtra.exists(filePath, resolve);
        });
    }

    /**
     * Load a file from disc into a string
     * @param filePath
     */
    public async  getFileContents(filePath: string) {
        let file = await fsExtra.readFile(filePath);
        let fileContents = file.toString();
        return fileContents;
    }

    /**
     * Make the path absolute, and replace all separators with the current OS's separators
     * @param filePath
     */
    public normalizeFilePath(filePath: string) {
        return path.normalize(path.resolve(filePath));
    }

    /**
     * Find the path to the config file.
     * If the config file path doesn't exist
     * @param configFilePath
     */
    public async  getConfigFilePath(cwd?: string) {
        cwd = cwd ? cwd : process.cwd();
        let configPath = path.join(cwd, 'brsconfig.json');
        //find the nearest config file path
        for (let i = 0; i < 100; i++) {
            if (await this.fileExists(configPath)) {
                return configPath;
            } else {
                let parentDirPath = path.dirname(path.dirname(configPath));
                configPath = path.join(parentDirPath, 'brsconfig.json');
            }
        }
    }

    /**
     * Load the contents of a config file.
     * If the file extends another config, this will load the base config as well.
     * @param configFilePath
     * @param parentProjectPaths
     */
    public async loadConfigFile(configFilePath: string, parentProjectPaths?: string[]) {
        let cwd = process.cwd();

        if (configFilePath) {
            //keep track of the inheritance chain
            parentProjectPaths = parentProjectPaths ? parentProjectPaths : [];
            configFilePath = path.resolve(configFilePath);
            if (parentProjectPaths && parentProjectPaths.indexOf(configFilePath) > -1) {
                parentProjectPaths.push(configFilePath);
                parentProjectPaths.reverse();
                throw new Error('Circular dependency detected: "' + parentProjectPaths.join('" => ') + '"');
            }
            //load the project file
            let projectFileContents = await this.getFileContents(configFilePath);
            let projectConfig = JSON.parse(projectFileContents) as BrsConfig;

            //set working directory to the location of the project file
            process.chdir(path.dirname(configFilePath));

            let result: BrsConfig;
            //if the project has a base file, load it
            if (projectConfig && typeof projectConfig.extends === 'string') {
                let baseProjectConfig = await this.loadConfigFile(projectConfig.extends, [...parentProjectPaths, configFilePath]);
                //extend the base config with the current project settings
                result = Object.assign({}, baseProjectConfig, projectConfig);
            } else {
                result = projectConfig;
                let ancestors = parentProjectPaths ? parentProjectPaths : [];
                ancestors.push(configFilePath);
                (result as any)._ancestors = parentProjectPaths;
            }

            //make any paths in the config absolute (relative to the CURRENT config file)
            if (result.outFile) {
                result.outFile = path.resolve(result.outFile);
            }
            if (result.rootDir) {
                result.rootDir = path.resolve(result.rootDir);
            }
            if (result.cwd) {
                result.cwd = path.resolve(result.cwd);
            }

            //restore working directory
            process.chdir(cwd);
            return result;
        }
    }

    /**
     * Given a BrsConfig object, start with defaults,
     * merge with brsconfig.json and the provided options.
     * @param config
     */
    public async normalizeAndResolveConfig(config: BrsConfig) {
        let result = this.normalizeConfig({});

        //if no options were provided, try to find a brsconfig.json file
        if (!config || !config.project) {
            result.project = await this.getConfigFilePath();
        } else {
            //use the config's project link
            result.project = config.project;
        }
        if (result.project) {
            let configFile = await this.loadConfigFile(result.project);
            result = Object.assign(result, configFile);
        }

        //override the defaults with the specified options
        result = Object.assign(result, config);

        return result;
    }

    /**
     * Set defaults for any missing items
     * @param config
     */
    public normalizeConfig(config: BrsConfig) {
        config = config ? config : {} as BrsConfig;
        config.deploy = config.deploy === true ? true : false;
        //use default options from rokuDeploy
        config.files = config.files ? config.files : rokuDeploy.getOptions().files;
        config.skipPackage = config.skipPackage === true ? true : false;
        let rootFolderName = path.basename(process.cwd());
        config.outFile = config.outFile ? config.outFile : `./out/${rootFolderName}.zip`;
        config.username = config.username ? config.username : 'rokudev';
        config.watch = config.watch === true ? true : false;
        config.ignoreErrorCodes = config.ignoreErrorCodes ? config.ignoreErrorCodes : [];
        config.emitFullPaths = config.emitFullPaths === true ? true : false;
        return config;
    }

    /**
     * Get the root directory from options.
     * Falls back to options.cwd.
     * Falls back to process.cwd
     * @param options
     */
    public getRootDir(options: BrsConfig) {
        let originalProcessCwd = process.cwd();

        let cwd = options.cwd;
        cwd = cwd ? cwd : process.cwd();
        let rootDir = options.rootDir ? options.rootDir : cwd;

        process.chdir(cwd);

        rootDir = path.resolve(rootDir);

        process.chdir(originalProcessCwd);

        return rootDir;
    }

    /**
     * Format a string with placeholders replaced by argument indexes
     * @param subject
     * @param params
     */
    public stringFormat(subject: string, ...args) {
        return subject.replace(/{(\d+)}/g, (match, num) => {
            return typeof args[num] !== 'undefined' ? args[num] : match;
        });
    }

    public valueKindToBrsType(kind: ValueKind): BrsType {
        switch (kind) {
            case ValueKind.Boolean: return new BooleanType();
            //TODO refine the function type on the outside (I don't think this ValueKind is actually returned)
            case ValueKind.Callable: return new FunctionType(new VoidType());
            case ValueKind.Double: return new DoubleType();
            case ValueKind.Dynamic: return new DynamicType();
            case ValueKind.Float: return new FloatType();
            case ValueKind.Int32: return new IntegerType();
            case ValueKind.Int64: return new LongIntegerType();
            case ValueKind.Invalid: return new InvalidType();
            case ValueKind.Object: return new ObjectType();
            case ValueKind.String: return new StringType();
            case ValueKind.Uninitialized: return new UninitializedType();
            case ValueKind.Void: return new VoidType();
        }
    }

    /**
     * Convert a 1-indexed brs Location to a 0-indexed vscode range
     * @param location
     */
    public locationToRange(location: brs.lexer.Location) {
        return Range.create(
            //brs error lines are 1-indexed
            location.start.line - 1,
            //brs error columns are 0-based
            location.start.column,
            location.end.line - 1,
            location.end.column
        );
    }

    /**
     * Compute the range of a function's body
     * @param func
     */
    public getBodyRangeForFunc(func: brs.parser.Expr.Function) {
        return Range.create(
            //func body begins at start of line after its declaration
            func.location.start.line,
            0,
            //func body ends right before the `end function|sub` line
            func.end.location.start.line - 1,
            //brs location columns are 0-based
            func.end.location.start.column
        );
    }

    /**
     * Given a list of callables, get that as a a dictionary indexed by name.
     * @param callables
     */
    public getCallableContainersByLowerName(callables: CallableContainer[]) {
        //find duplicate functions
        let result = {} as { [name: string]: CallableContainer[] };

        for (let callableContainer of callables) {
            let lowerName = callableContainer.callable.name.toLowerCase();

            //create a new array for this name
            if (result[lowerName] === undefined) {
                result[lowerName] = [];
            }
            result[lowerName].push(callableContainer);
        }
        return result;
    }

    /**
     *
     * @param severity
     */
    public severityToDiagnostic(severity: 'hint' | 'information' | 'warning' | 'error') {
        switch (severity) {
            case 'hint':
                return DiagnosticSeverity.Hint;
            case 'information':
                return DiagnosticSeverity.Information;
            case 'warning':
                return DiagnosticSeverity.Warning;
            case 'error':
            default:
                return DiagnosticSeverity.Error;
        }
    }

    /**
     * Split a file by newline characters (LF or CRLF)
     * @param text
     */
    public getLines(text: string) {
        return text.split(/\r?\n/);
    }

    /**
     * Given an absollute path to a source file, and a target path,
     * compute the pkg path for the target relative to the source file's location
     * @param containingFilePathAbsolute
     * @param targetPath
     */
    public getPkgPathFromTarget(containingFilePathAbsolute: string, targetPath: string) {
        //if the target starts with 'pkg:', it's an absolute path. Return as is
        if (targetPath.indexOf('pkg:/') === 0) {
            targetPath = targetPath.substring(5);
            if (targetPath === '') {
                return null;
            } else {
                return path.normalize(targetPath);
            }
        }
        if (targetPath === 'pkg:') {
            return null;
        }

        //remove the filename
        let containingFolder = path.normalize(path.dirname(containingFilePathAbsolute));
        //start with the containing folder, split by slash
        let result = containingFolder.split(path.sep);

        //split on slash
        let targetParts = path.normalize(targetPath).split(path.sep);

        for (let part of targetParts) {
            if (part === '' || part === '.') {
                //do nothing, it means current directory
                continue;
            }
            if (part === '..') {
                //go up one directory
                result.pop();
            } else {
                result.push(part);
            }
        }
        return result.join(path.sep);
    }

    /**
     * Compute the relative path from the source file to the target file
     * @param pkgSourcePathAbsolute  - the absolute path to the source relative to the package location
     * @param pkgTargetPathAbsolute  - the absolute path ro the target relative to the package location
     */
    public getRelativePath(pkgSourcePathAbsolute: string, pkgTargetPathAbsolute: string) {
        pkgSourcePathAbsolute = path.normalize(pkgSourcePathAbsolute);
        pkgTargetPathAbsolute = path.normalize(pkgTargetPathAbsolute);

        //break by path separator
        let sourceParts = pkgSourcePathAbsolute.split(path.sep);
        let targetParts = pkgTargetPathAbsolute.split(path.sep);

        let commonParts = [] as string[];
        //find their common root
        for (let i = 0; i < targetParts.length; i++) {
            if (targetParts[i].toLowerCase() === sourceParts[i].toLowerCase()) {
                commonParts.push(targetParts[i]);
            } else {
                //we found a non-matching part...so no more commonalities past this point
                break;
            }
        }

        //throw out the common parts from both sets
        sourceParts.splice(0, commonParts.length);
        targetParts.splice(0, commonParts.length);

        //throw out the filename part of source
        sourceParts.splice(sourceParts.length - 1, 1);
        //start out by adding updir paths for each remaining source part
        let resultParts = sourceParts.map((x) => '..');

        //now add every target part
        resultParts = [...resultParts, ...targetParts];
        return path.join.apply(path, resultParts);
    }

    /**
     * Find all properties in an object that match the predicate.
     * @param obj
     * @param predicate
     * @param parentKey
     */
    public findAllDeep<T>(obj: any, predicate: (value: any) => boolean | undefined, parentKey?: string) {
        let result = [] as Array<{ key: string; value: T }>;

        //base case. If this object maches, keep it as a result
        if (predicate(obj) === true) {
            result.push({
                key: parentKey,
                value: obj
            });
        }

        //look through all children
        if (obj instanceof Object) {
            for (let key in obj) {
                let value = obj[key];
                let fullKey = parentKey ? parentKey + '.' + key : key;
                if (typeof value === 'object') {
                    result = [...result, ...this.findAllDeep<T>(value, predicate, fullKey)];
                }
            }
        }
        return result;
    }

    /**
     * Test if `position` is in `range`. If the position is at the edges, will return true.
     * Adapted from core vscode
     * @param range
     * @param position
     */
    public rangeContains(range: Range, position: Position) {
        if (position.line < range.start.line || position.line > range.end.line) {
            return false;
        }
        if (position.line === range.start.line && position.character < range.start.character) {
            return false;
        }
        if (position.line === range.end.line && position.character > range.end.character) {
            return false;
        }
        return true;
    }

    /**
     * Parse an xml file and get back a javascript object containing its results
     * @param text
     */
    public parseXml(text: string) {
        return new Promise<any>((resolve, reject) => {
            xml2js.parseString(text, (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    }

    public propertyCount(object: object) {
        let count = 0;
        for (let key in object) {
            if (object.hasOwnProperty(key)) {
                count++;
            }
        }
        return count;
    }

    public defer<T>() {
        let resolve: (value?: T | PromiseLike<T>) => void;
        let reject: (reason?: any) => void;
        let promise = new Promise<T>((resolveValue, rejectValue) => {
            resolve = resolveValue;
            reject = rejectValue;
        });
        return {
            promise: promise,
            resolve: resolve,
            reject: reject
        };
    }

    public padLeft(subject: string, totalLength: number, char: string) {
        totalLength = totalLength > 1000 ? 1000 : totalLength;
        while (subject.length < totalLength) { subject = char + subject; }
        return subject;
    }

    /**
     * Given a URI, convert that to a regular fs path
     * @param uri
     */
    public uriToPath(uri: string) {
        return path.normalize(Uri.parse(uri).fsPath);
    }

    /**
     * Given a file path, convert it to a URI string
     */
    public pathToUri(pathAbsolute: string) {
        return Uri.file(pathAbsolute).toString();
    }

    /**
     * Get the outDir from options, taking into account cwd and absolute outFile paths
     * @param options
     */
    public getOutDir(options: BrsConfig) {
        options = this.normalizeConfig(options);
        let cwd = path.normalize(options.cwd ? options.cwd : process.cwd());
        if (path.isAbsolute(options.outFile)) {
            return path.dirname(options.outFile);
        } else {
            return path.normalize(path.join(cwd, path.dirname(options.outFile)));
        }
    }

    /**
     * Get paths to all files on disc that match this project's source list
     */
    public async getFilePaths(options: BrsConfig) {
        let rootDir = this.getRootDir(options);

        let files = await rokuDeploy.getFilePaths(options.files, path.dirname(options.outFile), rootDir);
        return files;
    }

    /**
     * Determine whether this diagnostic should be supressed or not, based on brs comment-flags
     * @param diagnostic
     */
    public diagnosticIsSuppressed(diagnostic: Diagnostic) {
        //for now, we only support suppressing brs file diagnostics
        if (diagnostic.file instanceof BrsFile) {
            for (let flag of diagnostic.file.commentFlags) {
                //this diagnostic is affected by this flag
                if (this.rangeContains(flag.affectedRange, diagnostic.location.start)) {
                    //if the flag acts upon this diagnostic's code
                    if (flag.codes === null || flag.codes.indexOf(diagnostic.code) > -1) {
                        return true;
                    }
                }
            }
        }
    }

    /**
     * Given a string, extract each item split by whitespace
     * @param text
     */
    public tokenizeByWhitespace(text: string) {
        let tokens = [] as Array<{ startIndex: number; text: string }>;
        let currentToken = null;
        for (let i = 0; i < text.length; i++) {
            let char = text[i];
            //if we hit whitespace
            if (char === ' ' || char === '\t') {
                if (currentToken) {
                    tokens.push(currentToken);
                    currentToken = null;
                }

                //we hit non-whitespace
            } else {
                if (!currentToken) {
                    currentToken = {
                        startIndex: i,
                        text: ''
                    };
                }
                currentToken.text += char;
            }
        }
        if (currentToken) {
            tokens.push(currentToken);
        }
        return tokens;
    }
    /**
     * The BRS library uses 1-based line indexes, and 0 based column indexes.
     * However, vscode expects zero-based for everything.
     * @param start - the location.start object from brs
     * @param end - the location.end object from brs
     */
    public brsRangeFromPositions(start: BrsPosition, end: BrsPosition) {
        return Range.create(
            start.line - 1,
            start.column,
            end.line - 1,
            end.column
        );
    }
}

export let util = new Util();
export default util;

interface BrsPosition {
    line: number;
    column: number;
}
