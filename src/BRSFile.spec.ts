import * as path from 'path';
import * as sinonImport from 'sinon';

import { BRSProgram } from './BRSProgram';
import { BRSFile } from './BRSFile';
import { expect } from 'chai';

describe('BRSFile', () => {
    let testProjectsPath = path.join(__dirname, '..', 'testProjects');

    let sinon = sinonImport.createSandbox();
    let rootDir = 'C:/projects/RokuApp';
    let program: BRSProgram;
    beforeEach(() => {
        program = new BRSProgram({ rootDir });
    });
    afterEach(() => {
        sinon.restore();
    });

    describe('parse', () => {
        it('finds line and column numbers for functions', () => {
            let file = new BRSFile('absolute_path/file.brs', 'relative_path/file.brs');
            file.parse(`
                function DoA()
                    print "A"
                end function

                 function DoB()
                     print "B"
                 end function
            `);
            expect(file.callables[0].name).to.equal('DoA');
            expect(file.callables[0].lineIndex).to.equal(1);
            expect(file.callables[0].columnIndexBegin).to.equal(25)
            expect(file.callables[0].columnIndexEnd).to.equal(28)

            expect(file.callables[1].name).to.equal('DoB');
            expect(file.callables[1].lineIndex).to.equal(5);
            expect(file.callables[1].columnIndexBegin).to.equal(26)
            expect(file.callables[1].columnIndexEnd).to.equal(29)
        });
    });

});