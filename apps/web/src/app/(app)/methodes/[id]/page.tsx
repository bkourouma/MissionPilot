import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BoutonAction } from "../../../../components/methodes/BoutonAction";
import { Alerte } from "../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../lib/identifiant";
import {
  hrefMethode,
  hrefVersion,
  libelleOrigine,
  peutGerer,
  type MethodeDetail,
} from "../../../../lib/methodes";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Méthode", "Method") };
}

/**
 * Détail d'une méthode : versions (brouillon, publiées, notes de version), héritage du
 * standard (STD-03) et mise à jour du standard proposée à une variante, avec analyse d'impact.
 */
export default async function PageMethode({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("standard.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = await chargerServeur<MethodeDetail>(`/api/methodes/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Méthode", "Method")}
          retour={{ href: "/methodes", libelle: t("Méthodes", "Methods") }}
        />
        <EtatErreur
          titre={t("La méthode n'a pas pu être chargée.", "The method could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefMethode(id)}
        />
      </div>
    );
  }
  const m = r.donnees;
  const gerer = peutGerer(utilisateur.roles);
  const brouillon = m.versions.find((v) => v.statut === "brouillon");
  const publiee = m.versions.find((v) => v.statut === "publiee");

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={m.libelle}
        retour={{ href: "/methodes", libelle: t("Méthodes", "Methods") }}
        soustitre={`${m.service_libelle} · ${t("code", "code")} ${m.code}`}
        badges={
          <BadgeStatut tonalite={m.origine === "standard" ? "neutre" : "succes"}>
            {libelleOrigine(m.origine, langue)}
          </BadgeStatut>
        }
      />
      {m.description ? <p>{m.description}</p> : null}

      {m.origine === "standard" ? (
        <Carte titre={t("Variante du cabinet", "Firm variant")}>
          {m.variante ? (
            <p>
              {t(
                "Le cabinet adapte cette méthode dans sa variante :",
                "The firm adapts this method in its variant:",
              )}{" "}
              <Link href={hrefMethode(m.variante.id)}>{m.variante.libelle}</Link>.
            </p>
          ) : (
            <div className="mp-pile">
              <p>
                {t(
                  "Le standard CabinetPilot se lit sans se modifier. Pour l'adapter (ajouts, pondérations, gabarits à votre charte), créez la variante du cabinet : elle hérite de la dernière version publiée, et ses différences restent visibles.",
                  "The CabinetPilot standard is read-only. To adapt it (additions, weightings, templates in your style), create the firm's variant: it inherits the latest published version, and its differences stay visible.",
                )}
              </p>
              {gerer && publiee ? (
                <BoutonAction
                  libelle={t("Créer la variante du cabinet", "Create the firm variant")}
                  chemin={`/api/methodes/${m.id}/variantes`}
                  variante="primaire"
                  icone="copie"
                  versionDans="version_id"
                />
              ) : null}
            </div>
          )}
        </Carte>
      ) : null}

      {m.parent ? (
        <p>
          {t("Hérite de la méthode du standard", "Inherits from the standard method")}{" "}
          <Link href={hrefMethode(m.parent.id)}>{m.parent.libelle}</Link>.
        </p>
      ) : null}

      {m.mise_a_jour_standard ? (
        <Alerte
          tonalite="info"
          titre={t(
            `Version ${m.mise_a_jour_standard.disponible.version} du standard disponible`,
            `Standard version ${m.mise_a_jour_standard.disponible.version} available`,
          )}
        >
          <p>
            {t(
              `La variante part de la version ${m.mise_a_jour_standard.base.version}.`,
              `The variant starts from version ${m.mise_a_jour_standard.base.version}.`,
            )}{" "}
            {m.mise_a_jour_standard.disponible.notes_version ?? ""}{" "}
            {t(
              "Rien ne change sans votre accord : analysez l'impact, puis créez une nouvelle version qui reprend le standard en gardant vos choix.",
              "Nothing changes without your agreement: analyze the impact, then create a new version that picks up the standard while keeping your choices.",
            )}
          </p>
          {publiee ? (
            <p>
              <Link href={`${hrefVersion(publiee.id)}#mise-a-jour`}>
                {t("Analyser l'impact", "Analyze the impact")}
              </Link>
            </p>
          ) : null}
          {gerer && !brouillon ? (
            <BoutonAction
              libelle={t("Créer la version mise à jour", "Create the updated version")}
              chemin={`/api/methodes/${m.id}/versions`}
              corps={{ rebaser: true }}
              icone="historique"
              versionDans="id"
            />
          ) : null}
        </Alerte>
      ) : null}

      <Carte titre={t("Versions", "Versions")}>
        <ul className="mp-liste-lignes">
          {m.versions.map((v) => (
            <li key={v.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <Link href={hrefVersion(v.id)} className="mp-lien-ligne">
                  {t(`Version ${v.version}`, `Version ${v.version}`)}
                </Link>
                <span className="mp-texte-doux mp-texte-petit">
                  {v.statut === "publiee"
                    ? t(
                        `Publiée le ${formaterDate(v.publie_le, undefined, langue)}${v.publie_par_nom ? ` par ${v.publie_par_nom}` : ""}`,
                        `Published on ${formaterDate(v.publie_le, undefined, langue)}${v.publie_par_nom ? ` by ${v.publie_par_nom}` : ""}`,
                      )
                    : t(
                        `Brouillon créé le ${formaterDate(v.cree_le, undefined, langue)}`,
                        `Draft created on ${formaterDate(v.cree_le, undefined, langue)}`,
                      )}
                  {v.base_standard_version
                    ? t(
                        ` · base : standard v${v.base_standard_version}`,
                        ` · base: standard v${v.base_standard_version}`,
                      )
                    : ""}
                </span>
                {v.notes_version ? <span>{v.notes_version}</span> : null}
              </div>
              <BadgeStatut tonalite={v.statut === "publiee" ? "succes" : "attention"}>
                {v.statut === "publiee" ? t("Publiée", "Published") : t("Brouillon", "Draft")}
              </BadgeStatut>
            </li>
          ))}
        </ul>
        {gerer && m.origine !== "standard" && !brouillon && publiee ? (
          <BoutonAction
            libelle={t("Nouvelle version", "New version")}
            chemin={`/api/methodes/${m.id}/versions`}
            icone="plus"
            versionDans="id"
          />
        ) : null}
      </Carte>
    </div>
  );
}
