using System;
using System.IO;
using System.Text;
using System.Reflection;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Presentation only. Account checks and message delivery stay in the plugin services.
internal static class Program {
 [STAThread]
 private static int Main(string[] args) {
  try {
   if(args.Length>=2&&(args[0]=="--store"||args[0]=="--open"||args[0]=="--discard")) {
    Guid transfer;if(!Guid.TryParseExact(args[1],"D",out transfer))return 2;
    var path=Path.Combine(Path.GetTempPath(),"ViTalk-Feishu-input-"+transfer.ToString("N")+".tmp");
    if(args[0]=="--discard"){if(args.Length!=2)return 2;File.Delete(path);WriteReceipt("{\"discarded\":true}");return 0;}
    if(args[0]=="--store") {
     int offset;if(args.Length!=4||!Int32.TryParse(args[2],out offset)||offset<0||offset>8*1024*1024||args[3].Length>8192)return 2;
     foreach(char c in args[3])if(!(c>='A'&&c<='Z'||c>='a'&&c<='z'||c>='0'&&c<='9'||c=='+'||c=='/'||c=='='))return 2;
     using(var file=new FileStream(path,offset==0?FileMode.CreateNew:FileMode.Open,FileAccess.Write,FileShare.None)) {
      if(file.Length!=offset)return 2;file.Position=offset;var bytes=Encoding.ASCII.GetBytes(args[3]);file.Write(bytes,0,bytes.Length);
     }
     WriteReceipt("{\"stored\":true}");return 0;
    }
    if(args.Length!=2)return 2;
    string payload;try{payload=File.ReadAllText(path,Encoding.ASCII);}finally{File.Delete(path);}
    args=new[]{payload};
   }
  } catch(Exception e){Console.Error.WriteLine(e.GetType().Name);return 1;}
  AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender, ResolveEventArgs e) {
   var name = new AssemblyName(e.Name).Name + ".dll";
   using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) {
    if(stream==null)return null;
    var bytes=new byte[stream.Length]; stream.Read(bytes,0,bytes.Length); return Assembly.Load(bytes);
   }
  };
  try { return Run(args); }
  catch(Exception e) { Console.Error.WriteLine(e.GetType().Name); return 1; }
 }
 private static void WriteReceipt(string receipt){using(var output=new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)))output.WriteLine(receipt);}
 [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
 private static int Run(string[] args) {
  if(args.Length!=1)return 2;
  var json=new JavaScriptSerializer {MaxJsonLength=64*1024*1024};
  var input=json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(Convert.FromBase64String(args[0])));
  if(!input.ContainsKey("draftId")||!input.ContainsKey("recipients"))return 2;
  var directory=Path.Combine(Path.GetTempPath(),"ViTalk-Feishu-"+Guid.NewGuid().ToString("N"));
  Directory.CreateDirectory(directory);
  try {
   using(var loader=Assembly.GetExecutingAssembly().GetManifestResourceStream("WebView2Loader.dll"))
   using(var output=File.Create(Path.Combine(directory,"WebView2Loader.dll")))loader.CopyTo(output);
   SetDllDirectory(directory);
   var attachments=input.ContainsKey("attachments")?input["attachments"] as System.Collections.IEnumerable:null;
   if(attachments!=null)foreach(Dictionary<string,object> attachment in attachments) {
    var bytes=File.ReadAllBytes((string)attachment["path"]);
    using(var image=Image.FromStream(new MemoryStream(bytes))) {attachment["width"]=image.Width;attachment["height"]=image.Height;}
    attachment["dataUrl"]="data:image/png;base64,"+Convert.ToBase64String(bytes);attachment.Remove("path");
   }
   Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
   object receipt=new {confirmed=false}; int exitCode=0;
   using(var form=new Form())using(var view=new WebView2()) {
    form.Text=input.ContainsKey("historyOnly")&&Object.Equals(input["historyOnly"],true)?"飞书 · 历史记录":"飞书 · 消息待确认";form.ClientSize=new Size(440,188);form.MinimumSize=new Size(400,188);
    form.StartPosition=FormStartPosition.CenterScreen;form.TopMost=true;form.FormBorderStyle=FormBorderStyle.None;
    form.BackColor=Color.FromArgb(36,37,43);view.DefaultBackgroundColor=form.BackColor;
    form.SizeChanged += delegate { RoundWindow(form); };
    RoundWindow(form);
    view.Dock=DockStyle.Fill;form.Controls.Add(view);
    form.Shown += async delegate {
     try {
      var environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(directory,"profile"));
      await view.EnsureCoreWebView2Async(environment);
      view.CoreWebView2.Settings.AreDevToolsEnabled=false;
      view.CoreWebView2.Settings.AreDefaultContextMenusEnabled=false;
      view.CoreWebView2.Settings.AreHostObjectsAllowed=false;
      view.CoreWebView2.PermissionRequested += delegate(object s,CoreWebView2PermissionRequestedEventArgs e){e.State=CoreWebView2PermissionState.Deny;};
      view.CoreWebView2.NewWindowRequested += delegate(object s,CoreWebView2NewWindowRequestedEventArgs e){e.Handled=true;};
      string documentUri=null;
      view.CoreWebView2.NavigationStarting += delegate(object s,CoreWebView2NavigationStartingEventArgs e){
       if(documentUri==null&&(e.Uri=="about:blank"||e.Uri.StartsWith("data:text/html;"))){documentUri=e.Uri;return;}
       e.Cancel=true;
      };
      view.CoreWebView2.WebMessageReceived += delegate(object s,CoreWebView2WebMessageReceivedEventArgs e) {
       if(e.Source!="about:blank"&&e.Source!=documentUri)return;
       var message=json.Deserialize<Dictionary<string,object>>(e.WebMessageAsJson);
       if(message.ContainsKey("renderError")){Console.Error.WriteLine("DIALOG_RENDER_FAILED: "+message["renderError"]);exitCode=1;form.Close();return;}
       if(message.ContainsKey("action")) {
        if((string)message["action"]=="drag"){ReleaseCapture();SendMessage(form.Handle,0xA1,2,0);}
        else if((string)message["action"]=="resize"&&message.ContainsKey("layout")) {
         var layout=message["layout"] as string;
         var height=layout=="history"?380:layout=="message-attachments"?380:layout=="message-long"?300:188;
         form.ClientSize=new Size(440,height);
        }
        else if((string)message["action"]=="open"&&message.ContainsKey("url")) {
         Uri uri;if(Uri.TryCreate(message["url"] as string,UriKind.Absolute,out uri)&&uri.Scheme=="https"&&String.IsNullOrEmpty(uri.UserInfo)&&(uri.Host=="feishu.cn"||uri.Host.EndsWith(".feishu.cn")))Process.Start(new ProcessStartInfo(uri.AbsoluteUri){UseShellExecute=true});
        }
        return;
       }
       if(!message.ContainsKey("confirmed")||!(message["confirmed"] is bool))return;
       receipt=message;form.Close();
      };
      await view.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("window.addEventListener('error',function(e){window.chrome.webview.postMessage({renderError:e.message});});window.__FEISHU_DIALOG__="+json.Serialize(input)+";");
      using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("dialog.html"))
      using(var reader=new StreamReader(stream))view.NavigateToString(reader.ReadToEnd());
      form.Activate();
     } catch(Exception e){Console.Error.WriteLine(e.GetType().Name);exitCode=1;form.Close();}
    };
    Application.Run(form);
   }
   using(var output=new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)))output.WriteLine(json.Serialize(receipt));
   return exitCode;
  } finally {
   SetDllDirectory(null);
   try{Directory.Delete(directory,true);}catch(IOException){}catch(UnauthorizedAccessException){}
  }
 }
 private static void RoundWindow(Form form) {
  var rectangle=form.ClientRectangle;const int diameter=32;
  using(var path=new GraphicsPath()) {
   path.AddArc(0,0,diameter,diameter,180,90);
   path.AddArc(rectangle.Width-diameter,0,diameter,diameter,270,90);
   path.AddArc(rectangle.Width-diameter,rectangle.Height-diameter,diameter,diameter,0,90);
   path.AddArc(0,rectangle.Height-diameter,diameter,diameter,90,90);path.CloseFigure();
   var previous=form.Region;form.Region=new Region(path);if(previous!=null)previous.Dispose();
  }
 }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]private static extern bool SetDllDirectory(string path);
 [DllImport("user32.dll")]private static extern bool ReleaseCapture();
 [DllImport("user32.dll")]private static extern IntPtr SendMessage(IntPtr hwnd,int msg,int wparam,int lparam);
}
