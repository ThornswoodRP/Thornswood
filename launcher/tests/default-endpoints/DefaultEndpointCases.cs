using System;
using System.Runtime.InteropServices.Marshalling;
using System.Threading;
namespace Thornswood {
static unsafe class DefaultEndpointCases {
 static int pass,fail;
 static void Check(string name,bool ok){if(ok){pass++;Console.WriteLine("PASS "+name);}else{fail++;Console.WriteLine("FAIL "+name);}}
 static int Main(){
  var changes=new DefaultEndpointChanges();long seen=changes.Version(VoiceCom.eRender);string desired="speaker A";
  changes.DefaultChanged(VoiceCom.eRender,VoiceCom.eConsole);
  desired="speaker B";
  Check("default speaker moves while the original remains valid",changes.ShouldReopen(VoiceCom.eRender,ref seen,"speaker A",()=>desired,out _));
  // Opening speaker B failed: no acknowledgment and no second Windows event.
  Check("failed replacement open remains pending without another notification",changes.ShouldReopen(VoiceCom.eRender,ref seen,"speaker A",()=>desired,out _));
  Check("successful replacement can acknowledge its selection generation",changes.ShouldReopen(VoiceCom.eRender,ref seen,"speaker A",()=>desired,out long openedGeneration)&&openedGeneration!=seen);
  seen=openedGeneration;Check("acknowledged replacement needs no restart",!changes.ShouldReopen(VoiceCom.eRender,ref seen,"speaker B",()=>desired,out _));
  changes.DefaultChanged(VoiceCom.eRender,VoiceCom.eCommunications);
  Check("render communications role does not replace console output",!changes.ShouldReopen(VoiceCom.eRender,ref seen,"speaker B",()=>"other role",out _));
  long capture=changes.Version(VoiceCom.eCapture);changes.DefaultChanged(VoiceCom.eCapture,VoiceCom.eCommunications);
  Check("default communications microphone moves without invalidation",changes.ShouldReopen(VoiceCom.eCapture,ref capture,"microphone A",()=>"microphone B",out _));
  changes.DefaultChanged(VoiceCom.eCapture,VoiceCom.eConsole);
  Check("an explicit named microphone stays selected",!changes.ShouldReopen(VoiceCom.eCapture,ref capture,"named microphone",()=>"named microphone",out _));
  changes.DefaultChanged(VoiceCom.eCapture,VoiceCom.eCommunications);
  Check("a missing default keeps the working stream",!changes.ShouldReopen(VoiceCom.eCapture,ref capture,"microphone A",()=>null,out _));
  Check("the missing-default event remains pending until replacement exists",changes.ShouldReopen(VoiceCom.eCapture,ref capture,"microphone A",()=>"microphone C",out _));
  seen=changes.Version(VoiceCom.eRender);changes.DefaultChanged(VoiceCom.eRender,VoiceCom.eConsole);
  Check("change during open is observed from the pre-open epoch",changes.ShouldReopen(VoiceCom.eRender,ref seen,"speaker A",()=>"speaker C",out _));
  changes.DefaultChanged(VoiceCom.eRender,VoiceCom.eConsole);
  Check("same endpoint does not restart",!changes.ShouldReopen(VoiceCom.eRender,ref seen,"speaker C",()=>{changes.DefaultChanged(VoiceCom.eRender,VoiceCom.eConsole);return "speaker C";},out _));
  Check("a change arriving during resolution is not consumed",changes.ShouldReopen(VoiceCom.eRender,ref seen,"speaker C",()=>"speaker D",out _));
  long before=changes.Version(VoiceCom.eRender);changes.Stop();changes.DefaultChanged(VoiceCom.eRender,VoiceCom.eConsole);
  Check("late notifications are ignored after stop",changes.Version(VoiceCom.eRender)==before);
  int registered=0,unregistered=0; nint saved=0;
  var watch=new VoiceDefaultDevices(p=>{registered++;saved=p;return 0;},p=>{unregistered++;return p==saved?0:unchecked((int)0x80004005);});
  var iid=new Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0");void* queried=null;
  void** vt=*(void***)saved;int hr=((delegate* unmanaged[MemberFunction]<void*,Guid*,void**,int>)vt[0])((void*)saved,&iid,&queried);
  Check("source-generated callback exposes the real IMMNotificationClient IID",hr==0&&queried!=null);
  long stamp=watch.Changes.Version(VoiceCom.eRender);
  if(queried!=null){void** q=*(void***)queried;hr=((delegate* unmanaged[MemberFunction]<void*,int,int,char*,int>)q[6])(queried,VoiceCom.eRender,VoiceCom.eConsole,null);Check("native vtable callback accepts a null endpoint ID",hr==0&&watch.Changes.Version(VoiceCom.eRender)>stamp);((delegate* unmanaged[MemberFunction]<void*,uint>)q[2])(queried);}
  watch.Dispose();watch.Dispose();Check("registration pointer is retained and unregistered once",registered==1&&unregistered==1);
  bool refused=false;try{using var rejected=new VoiceDefaultDevices(_=>unchecked((int)0x80004005),_=>0);}catch(System.Runtime.InteropServices.COMException){refused=true;}
  Check("failed native registration is surfaced",refused);
  int attempts=0;nint retained=0;bool samePointer=true;
  var retry=new VoiceDefaultDevices(p=>{retained=p;return 0;},p=>{samePointer&=p==retained;return ++attempts==1?unchecked((int)0x80004005):0;});
  uint beforeDetach=ReferenceCount(retained);
  refused=false;try{retry.Dispose();}catch(System.Runtime.InteropServices.COMException){refused=true;}
  uint afterDetach=ReferenceCount(retained);
  Check("failed unregistration retains the same COM reference",refused&&beforeDetach==afterDetach);
  void** retainedVtable=*(void***)retained;long stoppedVersion=retry.Changes.Version(VoiceCom.eRender);
  hr=((delegate* unmanaged[MemberFunction]<void*,int,int,char*,int>)retainedVtable[6])((void*)retained,VoiceCom.eRender,VoiceCom.eConsole,null);
  Check("Windows can still call the stopped callback after failed detach",hr==0&&retry.Changes.Version(VoiceCom.eRender)==stoppedVersion);
  retry.Dispose();Check("a failed detach retries with the original pointer",attempts==2&&samePointer);
  Console.WriteLine(pass+" passed, "+fail+" failed");return fail + VoiceEndpointWorkerCases.Run() == 0 ? 0 : 1;
 }
 static uint ReferenceCount(nint pointer){void** table=*(void***)pointer;uint count=((delegate* unmanaged[MemberFunction]<void*,uint>)table[1])((void*)pointer);((delegate* unmanaged[MemberFunction]<void*,uint>)table[2])((void*)pointer);return count;}
}
}
