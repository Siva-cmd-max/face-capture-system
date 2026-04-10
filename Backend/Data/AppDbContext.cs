using Microsoft.EntityFrameworkCore;
using Backend.Models;

namespace Backend.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

        public DbSet<User> Users { get; set; }
        public DbSet<FaceEmbedding> FaceEmbeddings { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            
            // Map to specific table names
            modelBuilder.Entity<User>().ToTable("Users");
            modelBuilder.Entity<FaceEmbedding>().ToTable("FaceEmbeddings");
        }
    }
}
