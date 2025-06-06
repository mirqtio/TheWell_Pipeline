const EntityExtractor = require('../../../src/enrichment/EntityExtractor');

describe('EntityExtractor', () => {
  let extractor;
  
  beforeEach(() => {
    extractor = new EntityExtractor();
  });
  
  describe('extractEntities', () => {
    it('should extract person names', async () => {
      const text = 'John Smith met with Jane Doe at the conference. Dr. Robert Johnson was also present.';
      
      const result = await extractor.extractEntities(text);
      
      expect(result.persons).toEqual(
        expect.arrayContaining([
          { name: 'John Smith', type: 'PERSON', confidence: expect.any(Number) },
          { name: 'Jane Doe', type: 'PERSON', confidence: expect.any(Number) },
          { name: 'Dr. Robert Johnson', type: 'PERSON', confidence: expect.any(Number) }
        ])
      );
      expect(result.persons.length).toBe(3);
    });
    
    it('should extract organizations', async () => {
      const text = 'Microsoft and Google announced a partnership. The World Health Organization issued guidelines.';
      
      const result = await extractor.extractEntities(text);
      
      expect(result.organizations).toEqual(
        expect.arrayContaining([
          { name: 'Microsoft', type: 'ORGANIZATION', confidence: expect.any(Number) },
          { name: 'Google', type: 'ORGANIZATION', confidence: expect.any(Number) },
          { name: 'World Health Organization', type: 'ORGANIZATION', confidence: expect.any(Number) }
        ])
      );
    });
    
    it('should extract locations', async () => {
      const text = 'The meeting will be held in New York City. Participants from London and Tokyo will join remotely.';
      
      const result = await extractor.extractEntities(text);
      
      expect(result.locations).toEqual(
        expect.arrayContaining([
          { name: 'New York City', type: 'LOCATION', confidence: expect.any(Number) },
          { name: 'London', type: 'LOCATION', confidence: expect.any(Number) },
          { name: 'Tokyo', type: 'LOCATION', confidence: expect.any(Number) }
        ])
      );
    });
    
    it('should extract dates and times', async () => {
      const text = 'The project deadline is December 31, 2024. We will meet on Monday at 3:00 PM.';
      
      const result = await extractor.extractEntities(text);
      
      expect(result.dates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ 
            text: 'December 31, 2024',
            type: 'DATE',
            parsed: expect.any(String)
          }),
          expect.objectContaining({ 
            text: 'Monday',
            type: 'DATE'
          })
        ])
      );
      
      expect(result.times).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ 
            text: '3:00 PM',
            type: 'TIME'
          })
        ])
      );
    });
    
    it('should extract emails and URLs', async () => {
      const text = 'Contact john@example.com for details. Visit https://example.com for more information.';
      
      const result = await extractor.extractEntities(text);
      
      expect(result.emails).toEqual([
        { address: 'john@example.com', type: 'EMAIL', confidence: 1.0 }
      ]);
      
      expect(result.urls).toEqual([
        { url: 'https://example.com', type: 'URL', confidence: 1.0 }
      ]);
    });
    
    it('should extract monetary amounts', async () => {
      const text = 'The budget is $1.5 million. We saved €10,000 on the project.';
      
      const result = await extractor.extractEntities(text);
      
      expect(result.money).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: '$1.5 million',
            type: 'MONEY',
            amount: 1500000,
            currency: 'USD'
          }),
          expect.objectContaining({
            text: '€10,000',
            type: 'MONEY',
            amount: 10000,
            currency: 'EUR'
          })
        ])
      );
    });
    
    it('should extract phone numbers', async () => {
      const text = 'Call (555) 123-4567 or +1-800-555-0123 for support.';
      
      const result = await extractor.extractEntities(text);
      
      expect(result.phones).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            number: '(555) 123-4567',
            type: 'PHONE'
          }),
          expect.objectContaining({
            number: '+1-800-555-0123',
            type: 'PHONE'
          })
        ])
      );
    });
    
    it('should handle empty text', async () => {
      const result = await extractor.extractEntities('');
      
      expect(result).toEqual({
        persons: [],
        organizations: [],
        locations: [],
        dates: [],
        times: [],
        emails: [],
        urls: [],
        money: [],
        phones: [],
        custom: []
      });
    });
    
    it('should deduplicate entities', async () => {
      const text = 'John Smith works at Microsoft. John Smith is the CEO of Microsoft.';
      
      const result = await extractor.extractEntities(text);
      
      expect(result.persons.filter(p => p.name === 'John Smith').length).toBe(1);
      expect(result.organizations.filter(o => o.name === 'Microsoft').length).toBe(1);
    });
    
    it('should support custom entity patterns', async () => {
      extractor.addCustomPattern('PROJECT', /PROJ-\d+/g);
      
      const text = 'Working on PROJ-1234 and PROJ-5678';
      
      const result = await extractor.extractEntities(text);
      
      expect(result.custom).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: 'PROJ-1234',
            type: 'PROJECT'
          }),
          expect.objectContaining({
            text: 'PROJ-5678',
            type: 'PROJECT'
          })
        ])
      );
    });
  });
  
  describe('extractFromDocument', () => {
    it('should extract entities from document object', async () => {
      const document = {
        id: 1,
        title: 'Meeting with John Smith from Microsoft',
        content: 'Discussed the new project timeline with John Smith.',
        metadata: {
          author: 'Jane Doe',
          tags: ['meeting', 'project']
        }
      };
      
      const result = await extractor.extractFromDocument(document);
      
      expect(result.documentId).toBe(1);
      expect(result.entities.persons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'John Smith' }),
          expect.objectContaining({ name: 'Jane Doe' })
        ])
      );
      expect(result.entities.organizations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Microsoft' })
        ])
      );
      expect(result.extractedAt).toBeInstanceOf(Date);
    });
  });
  
  describe('performance', () => {
    it('should process large documents efficiently', async () => {
      const largeText = `
        John Smith from Microsoft met with Jane Doe from Google on January 15, 2024.
        They discussed the partnership worth $5 million. Contact: john@microsoft.com
      `.repeat(100); // ~35KB of text
      
      const startTime = Date.now();
      const result = await extractor.extractEntities(largeText);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
      expect(result.persons.length).toBeGreaterThan(0);
      expect(result.organizations.length).toBeGreaterThan(0);
    });
  });
});