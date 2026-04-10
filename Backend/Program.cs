using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Configuration;
using Backend.Data;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);

// Add CORS policy to allow React Vite origin
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowViteApp", policy =>
    {
        policy.WithOrigins("http://localhost:5173", "http://localhost:3000") // Vite default ports
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// Configure Entity Framework Core with SQL Server using the provided connection string
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer("Server=LAPTOP-P4AOTAG5;Database=face_capture_dbDB;User Id=sa;Password=P@ssw0rd;TrustServerCertificate=True;"));

// Add controllers and configure JSON serialization
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    });

// Add Swagger services
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// Auto-Initialization logic to check and create DB
using (var scope = app.Services.CreateScope())
{
    var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    // EnsureCreated will create the database and tables if they don't exist
    // Tables Users (Id, Photo) and FaceEmbeddings (Id, UserId, Embedding) are created according to AppDbContext
    try
    {
        context.Database.EnsureCreated();
        Console.WriteLine("Database initialized successfully.");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"An error occurred creating the DB: {ex.Message}");
    }
}

// HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowViteApp");

app.UseRouting();
app.UseAuthorization();
app.MapControllers();

// Add redirect from root to swagger
app.MapGet("/", () => Results.Redirect("/swagger"));

app.Run();
