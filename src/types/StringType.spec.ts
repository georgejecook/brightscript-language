import { expect } from 'chai';
import { StringType } from './StringType';
import { DynamicType } from './DynamicType';

describe('StringType', () => {
    it('is equivalent to string types', () => {
        expect(new StringType().isEquivalentTo(new StringType())).to.be.true;
        expect(new StringType().isEquivalentTo(new DynamicType())).to.be.true;
    });
});