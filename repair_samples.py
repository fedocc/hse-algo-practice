#!/usr/bin/env python3
"""Backfill sample extraction from already imported, sanitized statement tables."""
import json,re,urllib.request
from html.parser import HTMLParser

def text(markup):
    class Parser(HTMLParser):
        def __init__(self):
            super().__init__(); self.parts=[]
        def handle_data(self, value): self.parts.append(value)
        def handle_starttag(self, tag, attrs):
            if tag in ('br','p','div','li'): self.parts.append('\n')
    parser=Parser(); parser.feed(markup)
    return ''.join(parser.parts).strip()

BASE='http://127.0.0.1:8765'
def extract(markup):
    result=[]
    for table in re.findall(r'<table\b[^>]*>(.*?)</table>',markup,re.S|re.I):
        headers=[text(x).strip() for x in re.findall(r'<th\b[^>]*>(.*?)</th>',table,re.S|re.I)]
        if len(headers)!=2 or headers[0] not in {'Ввод','Input'} or headers[1] not in {'Вывод','Output'}: continue
        for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>',table,re.S|re.I):
            cells=re.findall(r'<td\b[^>]*>(.*?)</td>',row,re.S|re.I)
            if len(cells)>=2:result.append({'input':text(cells[0]),'output':text(cells[1])})
    return result
def repair():
    data=json.load(urllib.request.urlopen(BASE+'/api/bootstrap'))
    jobs=[j for j in data['bridge']['jobs'] if j['action']=='import_contests']
    if not jobs:return
    fixed=[]
    for problem in data['problems']:
        if problem['source']!='yandex' or problem.get('examples'):continue
        samples=extract(problem.get('statement_html',''))
        if samples:fixed.append(dict(problem,examples=samples))
    for index in range(0,len(fixed),10):
        payload={'job_id':jobs[0]['job_id'],'status':'progress','problems':fixed[index:index+10]}
        req=urllib.request.Request(BASE+'/api/bridge/result',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
        json.load(urllib.request.urlopen(req))
    print(json.dumps({'samples_repaired':len(fixed)}))
if __name__=='__main__':repair()
